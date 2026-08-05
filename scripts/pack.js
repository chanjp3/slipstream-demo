// Injects src/app-logic.js into the design bundle (public/app.html).
// The bundle stores the page as a JSON string inside a
// <script type="__bundler/template"> tag; the app logic lives in a
// <script type="text/x-dc" data-dc-script> tag within that page.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const bundlePath = path.join(root, 'public', 'app.html');
const logicPath = path.join(root, 'src', 'app-logic.js');

const html = fs.readFileSync(bundlePath, 'utf8');
const logic = fs.readFileSync(logicPath, 'utf8');
if (/<\/script>/i.test(logic)) throw new Error('app-logic.js must not contain "</script>"');

const openTag = '<script type="__bundler/template">';
const tplStart = html.indexOf(openTag);
if (tplStart === -1) throw new Error('template script tag not found');
const jsonStart = tplStart + openTag.length;
const jsonEnd = html.indexOf('</script>', jsonStart);

const template = JSON.parse(html.slice(jsonStart, jsonEnd));

const marker = template.indexOf('data-dc-script');
if (marker === -1) throw new Error('data-dc-script not found in template');
const codeStart = template.indexOf('>', marker) + 1;
const codeEnd = template.indexOf('</script>', codeStart);

let newTemplate = template.slice(0, codeStart) + '\n' + logic + '\n' + template.slice(codeEnd);

// ---- markup patches (each applies once; guarded by a marker string) ----

// PWA + mobile: manifest/icon/theme tags, service-worker registration, and a
// responsive shim that stacks the desktop grids on phone-width screens (the
// design uses inline styles, so overrides need !important).
const APP_VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const PWA_HEAD = APP_VIEWPORT + `
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#2E6BE6">
<link rel="apple-touch-icon" href="/icon-192.png">
<style>
@media (max-width: 860px) {
  [data-screen-label] { display: flex !important; flex-direction: column !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
  [data-screen-label] > div { width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; border-right: none !important; }
  [data-screen-label] iframe { min-height: 58vh !important; }
  header { flex-wrap: wrap !important; height: auto !important; padding: 10px 12px !important; gap: 8px !important; }
  div[style*="position:fixed"][style*="width:340px"] { width: 100vw !important; left: 0 !important; right: auto !important; }
}
</style>
<scr` + `ipt>if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');</scr` + `ipt>`;

if (!newTemplate.includes('manifest.webmanifest')) {
  if (!newTemplate.includes(APP_VIEWPORT)) throw new Error('app viewport meta not found — template changed?');
  newTemplate = newTemplate.replace(APP_VIEWPORT, PWA_HEAD);
  console.log('applied PWA + mobile-shim markup patch');
}

// Mobile map expand: on phone widths an "Expand map" button floats over the
// request-screen map; tapping it makes the map (with its airport search
// panel) fullscreen. Injected as a survives-document-replacement script.
const MAP_EXPAND = `<style>
.slip-map-btn{display:none}
@media (max-width:860px){
  .slip-map-btn{display:flex;position:absolute;top:10px;left:10px;z-index:1200;background:#16233b;color:#fff;border:none;border-radius:10px;padding:9px 14px;font:700 12.5px system-ui;box-shadow:0 6px 18px rgba(10,20,40,.35);align-items:center;gap:6px;cursor:pointer}
  .slip-map-full{position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;z-index:4000 !important;background:#fff}
  .slip-map-full iframe{min-height:100vh !important;height:100vh !important}
}
</style>
<scr` + `ipt>
(function(){
  function ensure(){
    if(window.innerWidth>860)return;
    var frame=document.querySelector('[data-screen-label*="New request"] iframe');
    if(!frame)return;
    var host=frame.parentElement;
    if(!host||host.querySelector('.slip-map-btn'))return;
    if(getComputedStyle(host).position==='static')host.style.position='relative';
    var b=document.createElement('button');
    b.className='slip-map-btn';
    b.textContent='\\u26f6 Expand map';
    b.addEventListener('click',function(){
      var full=host.classList.toggle('slip-map-full');
      b.textContent=full?'\\u2715 Close map':'\\u26f6 Expand map';
      document.body.style.overflow=full?'hidden':'';
    });
    host.appendChild(b);
  }
  setInterval(ensure,800);
})();
</scr` + `ipt>
</head>`;

// OBSOLETE: the expand-button flow is superseded by tap-a-location-box. Strip
// the old injected script (it turns out template scripts DO execute) but keep
// the .slip-map-full CSS it carried, which the new flow still uses.
const MAP_EXPAND_KEEP_CSS = `<style>
@media (max-width:860px){
  .slip-map-full{position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;z-index:4000 !important;background:#fff}
  .slip-map-full iframe{min-height:100vh !important;height:100vh !important}
}
</style>
</head>`;
{
  const body = MAP_EXPAND.slice(0, -'</head>'.length);
  let stripped = 0;
  while (newTemplate.includes(body)) {
    newTemplate = newTemplate.replace(body, '');
    stripped++;
  }
  if (stripped) console.log('stripped', stripped, 'obsolete map-expand block(s)');
  if (!newTemplate.includes('.slip-map-full{position:fixed')) {
    newTemplate = newTemplate.replace('</head>', MAP_EXPAND_KEEP_CSS);
    console.log('applied fullscreen-map CSS');
  }
}

// The map pane collapses to 0 height when the desktop grid stacks — give the
// iframe's host a real height on phones.
const MAP_HEIGHT_FIX = `<style>
@media (max-width:860px){
  [data-screen-label] div:has(> iframe):not(.slip-map-full){min-height:60vh !important;height:60vh !important;position:relative !important}
}
</style>
</head>`;
// upgrade older height rule to exclude the fullscreen state
const HF_OLD = '[data-screen-label] div:has(> iframe){min-height:60vh !important;height:60vh !important;position:relative !important}';
if (newTemplate.includes(HF_OLD)) {
  newTemplate = newTemplate.replace(HF_OLD, '[data-screen-label] div:has(> iframe):not(.slip-map-full){min-height:60vh !important;height:60vh !important;position:relative !important}');
  console.log('upgraded map-height rule');
}
if (!newTemplate.includes(':has(> iframe)')) {
  newTemplate = newTemplate.replace('</head>', MAP_HEIGHT_FIX);
  console.log('applied mobile map-height fix');
}

// Account menu: make the header avatar clickable with a profile/settings/logout dropdown.
const AVATAR = '<div style="width:32px;height:32px;border-radius:50%;background:#16233b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">{{ avatarInitials }}</div>';
const ACCOUNT_MENU = `<div style="position:relative">
  <div sc-camel-on-click="{{ toggleMenu }}" style="width:32px;height:32px;border-radius:50%;background:#16233b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;cursor:pointer;user-select:none">{{ avatarInitials }}</div>
  <sc-if value="{{ menuOpen }}" hint-placeholder-val="{{ false }}">
  <div style="position:absolute;top:42px;right:0;width:280px;background:#ffffff;border:1px solid #e3e9f2;border-radius:14px;box-shadow:0 18px 44px rgba(22,35,59,.18);padding:16px;z-index:2000;text-align:left">
    <div style="font-size:14px;font-weight:800;color:#16233b">{{ accountName }}</div>
    <div style="font-size:12px;color:#68758d;margin-top:2px">{{ accountEmail }}</div>
    <div style="display:inline-block;margin-top:6px;padding:3px 10px;border-radius:999px;background:#e7eefc;color:#2E6BE6;font-size:11px;font-weight:800;letter-spacing:.5px">{{ accountRole }}</div>
    <div style="border-top:1px solid #eaeff6;margin:12px 0"></div>
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin-bottom:6px">PROFILE</div>
    <div style="display:flex;gap:6px">
      <input value="{{ profileName }}" sc-camel-on-change="{{ onProfileName }}" style="flex:1;min-width:0;border:1.5px solid #dde5f0;border-radius:8px;padding:7px 9px;font-size:12.5px">
      <button sc-camel-on-click="{{ saveProfile }}" style="border:none;cursor:pointer;background:#16233b;color:#fff;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700">Save</button>
    </div>
    <sc-if value="{{ isClient }}" hint-placeholder-val="{{ false }}">
    <div style="border-top:1px solid #eaeff6;margin:12px 0"></div>
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin-bottom:6px">SETTINGS</div>
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:12.5px;color:#4a5a76;font-weight:600">Show empty-leg deals</div>
      <button sc-camel-on-click="{{ toggleEL }}" style="border:none;cursor:pointer;border-radius:999px;padding:4px 12px;font-size:11.5px;font-weight:800;background:{{ elBg }};color:{{ elFg }}">{{ elLabel }}</button>
    </div>
    </sc-if>
    <div style="border-top:1px solid #eaeff6;margin:12px 0"></div>
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin-bottom:6px">CHANGE PASSWORD</div>
    <input type="password" value="{{ pwCurrent }}" sc-camel-on-change="{{ onPwCurrent }}" placeholder="Current password" style="width:100%;box-sizing:border-box;border:1.5px solid #dde5f0;border-radius:8px;padding:7px 9px;font-size:12.5px;margin-bottom:6px">
    <input type="password" value="{{ pwNew }}" sc-camel-on-change="{{ onPwNew }}" placeholder="New password (min. 8)" style="width:100%;box-sizing:border-box;border:1.5px solid #dde5f0;border-radius:8px;padding:7px 9px;font-size:12.5px;margin-bottom:6px">
    <button sc-camel-on-click="{{ changePassword }}" style="width:100%;border:none;cursor:pointer;background:#eef2f8;color:#16233b;border-radius:8px;padding:8px;font-size:12px;font-weight:700">Update password</button>
    <sc-if value="{{ acctMsg }}" hint-placeholder-val="{{ false }}">
    <div style="margin-top:8px;font-size:12px;color:#2E6BE6;font-weight:600">{{ acctMsg }}</div>
    </sc-if>
    <div style="border-top:1px solid #eaeff6;margin:12px 0"></div>
    <button sc-camel-on-click="{{ doLogout }}" style="width:100%;border:none;cursor:pointer;background:#fdecec;color:#b3261e;border-radius:8px;padding:9px;font-size:12.5px;font-weight:800">Log out</button>
  </div>
  </sc-if>
</div>`;

if (!newTemplate.includes('sc-camel-on-click="{{ toggleMenu }}"')) {
  if (!newTemplate.includes(AVATAR)) throw new Error('avatar markup not found — template changed?');
  newTemplate = newTemplate.replace(AVATAR, ACCOUNT_MENU);
  console.log('applied account-menu markup patch');
}

// Operator chat inbox: a MESSAGES section in the bid-desk sidebar listing every
// conversation (one per quote sent), opening the shared chat drawer.
const SIDEBAR_ANCHOR = '</sc-for>\n      </div>\n    </div>\n    <div style="overflow-y:auto;padding:22px 26px 60px">';
const INBOX_SECTION = `</sc-for>
      </div>
      <sc-if value="{{ hasInbox }}" hint-placeholder-val="{{ false }}">
      <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#8593ab;padding:18px 6px 10px">MESSAGES</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <sc-for list="{{ inboxItems }}" as="c" hint-placeholder-count="2">
          <button sc-camel-on-click="{{ c.onOpen }}" style="cursor:pointer;text-align:left;border:1.5px solid {{ c.bd }};background:{{ c.bg }};border-radius:12px;padding:11px 12px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <div style="font-size:12.5px;font-weight:800;color:#16233b;font-family:ui-monospace,Menlo,monospace">{{ c.route }}</div>
              <sc-if value="{{ c.badge }}" hint-placeholder-val="{{ false }}">
              <div style="font-size:10px;font-weight:800;letter-spacing:.5px;padding:2px 8px;border-radius:999px;background:{{ c.badgeBg }};color:{{ c.badgeFg }}">{{ c.badge }}</div>
              </sc-if>
            </div>
            <div style="font-size:11.5px;color:#68758d;margin-top:3px">{{ c.client }}</div>
            <div style="font-size:11.5px;color:#8593ab;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:270px">{{ c.preview }}</div>
          </button>
        </sc-for>
      </div>
      </sc-if>
    </div>
    <div style="overflow-y:auto;padding:22px 26px 60px">`;

if (!newTemplate.includes('{{ inboxItems }}')) {
  if (!newTemplate.includes(SIDEBAR_ANCHOR)) throw new Error('operator sidebar anchor not found — template changed?');
  newTemplate = newTemplate.replace(SIDEBAR_ANCHOR, INBOX_SECTION);
  console.log('applied operator-inbox markup patch');
}

// The chat drawer lives inside the client-only quotes screen; copy it into the
// operator screen so operators can read and reply. It is position:fixed and all
// its bindings (chatOpen/chatName/chatMsgs/chatText/…) are role-agnostic.
// NOTE: must run before the contract-section patch — extraction relies on the
// drawer's first </sc-if> being its own close.
const OP_OPEN = '<sc-if value="{{ showOperator }}" hint-placeholder-val="{{ false }}">';
const drawerCount = (newTemplate.match(/\{\{ chatOpen \}\}/g) || []).length;
if (drawerCount === 1) {
  const di = newTemplate.indexOf('<sc-if value="{{ chatOpen }}"');
  if (di === -1) throw new Error('chat drawer not found — template changed?');
  const dEnd = newTemplate.indexOf('</sc-if>', di) + '</sc-if>'.length;
  const drawer = newTemplate.slice(di, dEnd);
  if (!newTemplate.includes(OP_OPEN)) throw new Error('operator screen anchor not found — template changed?');
  newTemplate = newTemplate.replace(OP_OPEN, OP_OPEN + '\n  ' + drawer);
  console.log('applied operator-chat-drawer markup patch');
}

// Unread badge on the traveler's quote-card Message button.
if (!newTemplate.includes('{{ q.msgLabel }}')) {
  if (!newTemplate.includes('>Message</button>')) throw new Error('Message button not found — template changed?');
  newTemplate = newTemplate.replace('>Message</button>', '>{{ q.msgLabel }}</button>');
  console.log('applied unread-message-label markup patch');
}

// Contract section in the chat drawer (both copies): operators attach a file or
// a DocuSign-style signing link; both parties see and open what's attached.
const DRAWER_MSGS = '<div style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px">';
const CONTRACT_SECTION = `<sc-if value="{{ ctShow }}" hint-placeholder-val="{{ false }}">
      <div style="padding:12px 16px;border-bottom:1px solid #eaeff6;background:#f8fafd">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin-bottom:7px">CONTRACT</div>
        <sc-if value="{{ ctHas }}" hint-placeholder-val="{{ false }}">
        <a href="{{ ctHref }}" target="_blank" style="display:flex;align-items:center;gap:8px;text-decoration:none;border:1.5px solid #dde5f0;background:#fff;border-radius:10px;padding:9px 11px;margin-bottom:6px">
          <div style="font-size:15px">📄</div>
          <div style="flex:1;min-width:0;font-size:12.5px;font-weight:700;color:#16233b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ ctName }}</div>
          <div style="font-size:11.5px;font-weight:800;color:#2E6BE6">Open</div>
        </a>
        </sc-if>
        <sc-if value="{{ ctIsOp }}" hint-placeholder-val="{{ false }}">
        <label style="display:block;cursor:pointer;border:1.5px dashed #b9c8e0;border-radius:10px;padding:9px;text-align:center;font-size:12px;font-weight:700;color:#2E6BE6;background:#fff">
          Upload contract (PDF)
          <input type="file" accept=".pdf,.doc,.docx,application/pdf" sc-camel-on-change="{{ onCtFile }}" style="display:none">
        </label>
        <div style="display:flex;gap:6px;margin-top:6px">
          <input value="{{ ctLink }}" sc-camel-on-change="{{ onCtLink }}" placeholder="or paste DocuSign link…" style="flex:1;min-width:0;border:1.5px solid #dde5f0;border-radius:8px;padding:7px 9px;font-size:12px">
          <button sc-camel-on-click="{{ attachCtLink }}" style="border:none;cursor:pointer;background:#16233b;color:#fff;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700">Attach</button>
        </div>
        </sc-if>
        <sc-if value="{{ ctMsg }}" hint-placeholder-val="{{ false }}">
        <div style="margin-top:6px;font-size:11.5px;color:#2E6BE6;font-weight:600">{{ ctMsg }}</div>
        </sc-if>
      </div>
      </sc-if>
      ` + DRAWER_MSGS;

if (!newTemplate.includes('{{ ctShow }}')) {
  const copies = newTemplate.split(DRAWER_MSGS).length - 1;
  if (copies < 1) throw new Error('chat drawer messages container not found — template changed?');
  newTemplate = newTemplate.split(DRAWER_MSGS).join(CONTRACT_SECTION);
  console.log('applied contract-section markup patch to ' + copies + ' drawer cop' + (copies === 1 ? 'y' : 'ies'));
}

// Airport search box in the map's "Airports in view" panel — searches all
// airports (not just those in view); results reuse the visibleList bindings.
const AP_PANEL_HEADER = `<div style="padding:13px 15px 9px;border-bottom:1px solid #eaeff6">
          <div style="font-size:13.5px;font-weight:800">Airports in view</div>
          <div style="font-size:11.5px;color:#68758d;margin-top:1px">{{ visibleCount }} in this area — zoom to narrow</div>
        </div>`;
const AP_PANEL_SEARCH = `<div style="padding:13px 15px 11px;border-bottom:1px solid #eaeff6">
          <div style="font-size:13.5px;font-weight:800">{{ apListTitle }}</div>
          <div style="font-size:11.5px;color:#68758d;margin-top:1px">{{ apListSub }}</div>
          <div style="position:relative;margin-top:8px">
            <input value="{{ apSearch }}" sc-camel-on-change="{{ onApSearch }}" placeholder="Search airport, city, or code…" style="width:100%;box-sizing:border-box;border:1.5px solid #dde5f0;border-radius:9px;padding:8px 28px 8px 10px;font-size:12.5px">
            <sc-if value="{{ apSearchActive }}" hint-placeholder-val="{{ false }}">
            <button sc-camel-on-click="{{ clearApSearch }}" style="position:absolute;right:5px;top:50%;transform:translateY(-50%);border:none;background:#eef2f8;border-radius:6px;width:20px;height:20px;cursor:pointer;font-size:11px;color:#4a5a76;line-height:1;padding:0">✕</button>
            </sc-if>
          </div>
        </div>`;

if (!newTemplate.includes('{{ apListTitle }}')) {
  if (!newTemplate.includes(AP_PANEL_HEADER)) throw new Error('airports-in-view header not found — template changed?');
  newTemplate = newTemplate.replace(AP_PANEL_HEADER, AP_PANEL_SEARCH);
  console.log('applied airport-search markup patch');
}

// Mobile map flow: the map pane is hidden on phones until a FROM/TO location
// box is tapped, then it opens fullscreen; picking an airport closes it.
const MAP_HOST_OPEN = '<div style="position:relative;min-width:0">';
if (!newTemplate.includes('{{ mapHostClass }}')) {
  if (newTemplate.split(MAP_HOST_OPEN).length - 1 !== 1) throw new Error('map host anchor not unique — template changed?');
  newTemplate = newTemplate.replace(MAP_HOST_OPEN, '<div class="{{ mapHostClass }}" style="position:relative;min-width:0">');
  console.log('applied mobile map-flow markup patch');
}

// The standalone close button overlapped the prompt bar — the ✕ lives inside
// the prompt bar now. Remove the old floating button from packed templates.
const OLD_MAP_CLOSE = `<sc-if value="{{ mapCloseShow }}" hint-placeholder-val="{{ false }}">
      <button sc-camel-on-click="{{ closeMap }}" aria-label="Close map" style="position:absolute;top:14px;left:14px;z-index:1300;width:40px;height:40px;border-radius:12px;background:#16233b;color:#fff;border:none;cursor:pointer;font-size:15px;box-shadow:0 8px 24px rgba(10,20,40,.35);padding:0">✕</button>
      </sc-if>`;
if (newTemplate.includes(OLD_MAP_CLOSE)) {
  newTemplate = newTemplate.replace(OLD_MAP_CLOSE, '');
  console.log('removed old floating map-close button');
}

// Prompt bar: cap its width so it never runs under the airports panel
// (desktop) or the magnifier (mobile), and host the map ✕ inside it.
const PROMPT_OPEN = '<div style="position:absolute;top:14px;left:14px;z-index:1000;display:flex;align-items:center;gap:9px;background:#16233b;color:#fff;border-radius:10px;padding:10px 15px;box-shadow:0 4px 16px rgba(22,35,59,.3);max-width:340px">';
if (!newTemplate.includes('slip-prompt')) {
  if (!newTemplate.includes(PROMPT_OPEN)) throw new Error('map prompt bar anchor not found — template changed?');
  newTemplate = newTemplate.replace(PROMPT_OPEN,
    `<div class="slip-prompt" style="position:absolute;top:14px;left:14px;z-index:1000;display:flex;align-items:center;gap:9px;background:#16233b;color:#fff;border-radius:10px;padding:10px 15px;box-shadow:0 4px 16px rgba(22,35,59,.3);max-width:340px">
        <sc-if value="{{ mapCloseShow }}" hint-placeholder-val="{{ false }}">
        <button sc-camel-on-click="{{ closeMap }}" aria-label="Close map" style="flex:none;width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,.16);color:#fff;border:none;cursor:pointer;font-size:12px;padding:0">✕</button>
        </sc-if>`);
  newTemplate = newTemplate.replace('</head>',
    '<style>.slip-prompt{box-sizing:border-box;max-width:min(340px,calc(100% - 320px)) !important}'
    + '@media (max-width:860px){.slip-prompt{max-width:calc(100vw - 88px) !important}}</style>\n</head>');
  console.log('applied prompt-bar layout patch');
}
// slip-prompt vw upgrade: containing-block % proved unreliable in fullscreen
if (newTemplate.includes('.slip-prompt{max-width:calc(100% - 88px) !important}')) {
  newTemplate = newTemplate.replace('.slip-prompt{max-width:calc(100% - 88px) !important}', '.slip-prompt{max-width:calc(100vw - 88px) !important}');
  console.log('upgraded prompt-bar mobile cap to vw');
}
// border-box upgrade: app has no global reset, padding sat on top of max-width
if (newTemplate.includes('<style>.slip-prompt{max-width:min(340px')) {
  newTemplate = newTemplate.replace('<style>.slip-prompt{max-width:min(340px', '<style>.slip-prompt{box-sizing:border-box;max-width:min(340px');
  console.log('upgraded prompt-bar to border-box');
}
const HIDDEN_CSS = '<style>.slip-map-hidden{display:none !important}</style>\n</head>';
if (!newTemplate.includes('.slip-map-hidden{display:none')) {
  newTemplate = newTemplate.replace('</head>', HIDDEN_CSS);
  console.log('applied map-hidden CSS patch');
}

// Mobile airport panel: collapsed to a magnifier button until tapped; an ✕
// closes it. Desktop keeps the always-visible panel (apPanelDisp = 'flex').
const AP_PANEL_OPEN = '<div style="position:absolute;top:14px;right:14px;bottom:14px;z-index:1000;width:272px;display:flex;flex-direction:column;background:rgba(255,255,255,.96);backdrop-filter:blur(6px);border-radius:14px;box-shadow:0 6px 24px rgba(22,35,59,.16);overflow:hidden">';
const AP_PANEL_MOBILE = `<sc-if value="{{ apFabShow }}" hint-placeholder-val="{{ false }}">
      <button sc-camel-on-click="{{ openApPanel }}" aria-label="Search airports" style="position:absolute;top:14px;right:14px;z-index:1001;width:46px;height:46px;border-radius:50%;background:#16233b;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(10,20,40,.35);display:flex;align-items:center;justify-content:center">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>
      </button>
      </sc-if>
      <div style="position:absolute;top:14px;right:14px;bottom:14px;z-index:1000;width:272px;display:{{ apPanelDisp }};flex-direction:column;background:rgba(255,255,255,.96);backdrop-filter:blur(6px);border-radius:14px;box-shadow:0 6px 24px rgba(22,35,59,.16);overflow:hidden">
        <sc-if value="{{ apCloseShow }}" hint-placeholder-val="{{ false }}">
        <button sc-camel-on-click="{{ closeApPanel }}" aria-label="Close search" style="position:absolute;top:9px;right:9px;z-index:5;width:26px;height:26px;border-radius:8px;background:#eef2f8;border:none;cursor:pointer;font-size:12px;color:#4a5a76;padding:0">✕</button>
        </sc-if>`;

if (!newTemplate.includes('{{ apPanelDisp }}')) {
  if (!newTemplate.includes(AP_PANEL_OPEN)) throw new Error('airport panel anchor not found — template changed?');
  newTemplate = newTemplate.replace(AP_PANEL_OPEN, AP_PANEL_MOBILE);
  console.log('applied mobile airport-panel markup patch');
}

// Plan section in the account menu (above CHANGE PASSWORD), with demo upgrade.
const PW_HEADER = '<div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin-bottom:6px">CHANGE PASSWORD</div>';
const PLAN_SECTION = `<div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin-bottom:6px">PLAN</div>
    <div style="font-size:13px;font-weight:800;color:#16233b">{{ planLabel }}</div>
    <div style="font-size:11.5px;color:#68758d;margin-top:2px">{{ planDetail }}</div>
    <sc-if value="{{ planIsFree }}" hint-placeholder-val="{{ false }}">
    <button sc-camel-on-click="{{ openCheckout }}" style="width:100%;margin-top:8px;border:none;cursor:pointer;background:#2E6BE6;color:#fff;border-radius:8px;padding:8px;font-size:12px;font-weight:800">{{ planUpgradeLabel }}</button>
    </sc-if>
    <sc-if value="{{ planIsPaid }}" hint-placeholder-val="{{ false }}">
    <button sc-camel-on-click="{{ downgradePlan }}" style="width:100%;margin-top:8px;border:1.5px solid #dde5f0;cursor:pointer;background:#fff;color:#68758d;border-radius:8px;padding:7px;font-size:11.5px;font-weight:700">Switch to Free (demo)</button>
    </sc-if>
    <div style="border-top:1px solid #eaeff6;margin:12px 0"></div>
    ` + PW_HEADER;

if (!newTemplate.includes('{{ planLabel }}')) {
  if (!newTemplate.includes(PW_HEADER)) throw new Error('account-menu password header not found — template changed?');
  newTemplate = newTemplate.replace(PW_HEADER, PLAN_SECTION);
  console.log('applied plan-section markup patch');
}

// Operator-profile entry in the account menu (operators only), above PLAN.
const PLAN_HEADER = '<div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin-bottom:6px">PLAN</div>';
const COMPANY_ENTRY = `<sc-if value="{{ profBtnShow }}" hint-placeholder-val="{{ false }}">
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin-bottom:6px">COMPANY</div>
    <button sc-camel-on-click="{{ openProfile }}" style="width:100%;border:1.5px solid #dde5f0;cursor:pointer;background:#fff;color:#16233b;border-radius:8px;padding:8px;font-size:12px;font-weight:700;text-align:left;display:flex;justify-content:space-between;align-items:center">
      <span>Operator profile &amp; FAA check</span>
      <span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;background:{{ profBadgeBg }};color:{{ profBadgeFg }}">{{ profBadge }}</span>
    </button>
    <div style="border-top:1px solid #eaeff6;margin:12px 0"></div>
    </sc-if>
    ` + PLAN_HEADER;

if (!newTemplate.includes('{{ openProfile }}')) {
  if (!newTemplate.includes(PLAN_HEADER)) throw new Error('PLAN header not found — template changed?');
  newTemplate = newTemplate.replace(PLAN_HEADER, COMPANY_ENTRY);
  console.log('applied company-entry markup patch');
}

// Operator profile modal: company + FAA certificate, fleet with per-tail FAA
// registry verification, and D085 upload.
const PROFILE_MODAL = `<sc-if value="{{ profileOpen }}" hint-placeholder-val="{{ false }}">
<div style="position:fixed;inset:0;background:rgba(10,20,40,.55);display:flex;align-items:center;justify-content:center;z-index:3000">
  <div style="background:#fff;border-radius:18px;padding:24px;width:470px;max-width:94vw;max-height:88vh;overflow-y:auto;box-shadow:0 24px 60px rgba(10,30,80,.35)">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:18px;font-weight:800;color:#16233b">Operator profile</div>
      <button sc-camel-on-click="{{ closeProfile }}" style="border:none;background:#eef2f8;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:13px;color:#4a5a76">✕</button>
    </div>
    <div style="display:inline-block;margin-top:8px;padding:3px 10px;border-radius:999px;background:{{ profBadgeBg }};color:{{ profBadgeFg }};font-size:11px;font-weight:800;letter-spacing:.5px">{{ profBadge }}</div>

    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin:16px 0 6px">COMPANY</div>
    <input value="{{ prCompany }}" sc-camel-on-change="{{ onPrCompany }}" placeholder="Company name" style="width:100%;box-sizing:border-box;border:1.5px solid #dde5f0;border-radius:9px;padding:9px 11px;font-size:13px;margin-bottom:7px">
    <div style="display:flex;gap:7px">
      <input value="{{ prCert }}" sc-camel-on-change="{{ onPrCert }}" placeholder="FAA Part 135 certificate # (e.g. ABCD123E)" style="flex:1;min-width:0;border:1.5px solid #dde5f0;border-radius:9px;padding:9px 11px;font-size:13px">
      <input value="{{ prBase }}" sc-camel-on-change="{{ onPrBase }}" placeholder="Base (TEB)" style="width:90px;border:1.5px solid #dde5f0;border-radius:9px;padding:9px 11px;font-size:13px">
    </div>
    <button sc-camel-on-click="{{ saveOpProfile }}" style="margin-top:8px;border:none;cursor:pointer;background:#16233b;color:#fff;border-radius:8px;padding:8px 16px;font-size:12.5px;font-weight:700">Save company info</button>

    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin:18px 0 6px">FLEET · AS LISTED ON YOUR D085</div>
    <sc-for list="{{ prFleet }}" as="a" hint-placeholder-count="2">
      <div style="border:1.5px solid #e3e9f2;border-radius:10px;padding:9px 11px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="min-width:0"><span style="font-family:ui-monospace,Menlo,monospace;font-weight:800;font-size:12.5px;color:#16233b">{{ a.tail }}</span> <span style="font-size:12.5px;color:#4a5a76;font-weight:600">{{ a.model }}</span></div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <span style="font-size:9.5px;font-weight:800;letter-spacing:.5px;padding:2px 8px;border-radius:999px;background:{{ a.statusBg }};color:{{ a.statusFg }}">{{ a.status }}</span>
            <button sc-camel-on-click="{{ a.onRemove }}" style="border:none;background:#eef2f8;border-radius:6px;width:20px;height:20px;cursor:pointer;font-size:10px;color:#4a5a76;padding:0">✕</button>
          </div>
        </div>
        <sc-if value="{{ a.faaInfo }}" hint-placeholder-val="{{ false }}">
        <div style="font-size:11px;color:#8593ab;margin-top:3px">{{ a.faaInfo }}</div>
        </sc-if>
      </div>
    </sc-for>
    <div style="display:flex;gap:6px;margin-top:2px">
      <input value="{{ prTail }}" sc-camel-on-change="{{ onPrTail }}" placeholder="N-number" style="width:110px;border:1.5px solid #dde5f0;border-radius:9px;padding:8px 10px;font-size:12.5px">
      <input value="{{ prModel }}" sc-camel-on-change="{{ onPrModel }}" placeholder="Model (e.g. Challenger 350)" style="flex:1;min-width:0;border:1.5px solid #dde5f0;border-radius:9px;padding:8px 10px;font-size:12.5px">
      <button sc-camel-on-click="{{ addAircraft }}" style="border:none;cursor:pointer;background:#16233b;color:#fff;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700">Add</button>
    </div>
    <sc-if value="{{ prHasFleet }}" hint-placeholder-val="{{ false }}">
    <button sc-camel-on-click="{{ runFaaCheck }}" style="width:100%;margin-top:8px;border:none;cursor:pointer;background:#2E6BE6;color:#fff;border-radius:9px;padding:10px;font-size:13px;font-weight:800">Run FAA registry check</button>
    </sc-if>

    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin:18px 0 6px">D085 OPSPEC (AIRCRAFT LISTING)</div>
    <sc-if value="{{ hasD085 }}" hint-placeholder-val="{{ false }}">
    <a href="/api/operator/d085" target="_blank" style="display:flex;align-items:center;gap:8px;text-decoration:none;border:1.5px solid #dde5f0;background:#fff;border-radius:10px;padding:9px 11px;margin-bottom:6px">
      <div style="font-size:15px">📄</div>
      <div style="flex:1;min-width:0;font-size:12.5px;font-weight:700;color:#16233b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ d085Name }}</div>
      <div style="font-size:11.5px;font-weight:800;color:#2E6BE6">Open</div>
    </a>
    </sc-if>
    <label style="display:block;cursor:pointer;border:1.5px dashed #b9c8e0;border-radius:10px;padding:9px;text-align:center;font-size:12px;font-weight:700;color:#2E6BE6;background:#fff">
      Upload D085 (PDF)
      <input type="file" accept=".pdf,application/pdf" sc-camel-on-change="{{ onD085File }}" style="display:none">
    </label>
    <div style="margin-top:8px;font-size:11px;color:#8593ab;line-height:1.5">Tail numbers are checked live against the FAA aircraft registry. Your D085 is kept on file so travelers know your fleet listing matches your operating certificate — holding a Part 135 certificate is what distinguishes an operator from a broker.</div>
    <sc-if value="{{ prMsg }}" hint-placeholder-val="{{ false }}">
    <div style="margin-top:8px;font-size:12px;color:#2E6BE6;font-weight:600">{{ prMsg }}</div>
    </sc-if>
  </div>
</div>
</sc-if>
</x-dc>`;

if (!newTemplate.includes('{{ profileOpen }}')) {
  if (!newTemplate.includes('</x-dc>')) throw new Error('x-dc close not found — template changed?');
  newTemplate = newTemplate.replace('</x-dc>', PROFILE_MODAL);
  console.log('applied operator-profile-modal markup patch');
}

// Profile modal v2: admin/member team management. Replaces the v1 modal
// wholesale (it sits immediately before </x-dc>).
const MODAL_V2 = `<sc-if value="{{ profileOpen }}" hint-placeholder-val="{{ false }}">
<div style="position:fixed;inset:0;background:rgba(10,20,40,.55);display:flex;align-items:center;justify-content:center;z-index:3000">
  <div style="background:#fff;border-radius:18px;padding:24px;width:470px;max-width:94vw;max-height:88vh;overflow-y:auto;box-shadow:0 24px 60px rgba(10,30,80,.35)">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:18px;font-weight:800;color:#16233b">Operator profile</div>
      <button sc-camel-on-click="{{ closeProfile }}" style="border:none;background:#eef2f8;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:13px;color:#4a5a76">✕</button>
    </div>
    <div style="display:inline-block;margin-top:8px;padding:3px 10px;border-radius:999px;background:{{ profBadgeBg }};color:{{ profBadgeFg }};font-size:11px;font-weight:800;letter-spacing:.5px">{{ profBadge }}</div>

    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin:16px 0 6px">COMPANY</div>
    <sc-if value="{{ prIsAdmin }}" hint-placeholder-val="{{ false }}">
    <input value="{{ prCompany }}" sc-camel-on-change="{{ onPrCompany }}" placeholder="Company name" style="width:100%;box-sizing:border-box;border:1.5px solid #dde5f0;border-radius:9px;padding:9px 11px;font-size:13px;margin-bottom:7px">
    <div style="display:flex;gap:7px">
      <input value="{{ prCert }}" sc-camel-on-change="{{ onPrCert }}" placeholder="FAA Part 135 certificate # (e.g. ABCD123E)" style="flex:1;min-width:0;border:1.5px solid #dde5f0;border-radius:9px;padding:9px 11px;font-size:13px">
      <input value="{{ prBase }}" sc-camel-on-change="{{ onPrBase }}" placeholder="Base (TEB)" style="width:90px;border:1.5px solid #dde5f0;border-radius:9px;padding:9px 11px;font-size:13px">
    </div>
    <button sc-camel-on-click="{{ saveOpProfile }}" style="margin-top:8px;border:none;cursor:pointer;background:#16233b;color:#fff;border-radius:8px;padding:8px 16px;font-size:12.5px;font-weight:700">Save company info</button>
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin:16px 0 6px">SAFETY RATING</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      <sc-for list="{{ safetyOpts }}" as="o" hint-placeholder-count="4">
        <button sc-camel-on-click="{{ o.onPick }}" style="cursor:pointer;border:1.5px solid {{ o.bd }};background:{{ o.bg }};color:{{ o.fg }};border-radius:999px;padding:5px 11px;font-size:11.5px;font-weight:700">{{ o.label }}</button>
      </sc-for>
    </div>
    <div style="margin-top:5px;font-size:10.5px;color:#8593ab">Shown on your quotes. Tap again to clear. Upload your audit certificate below for the record.</div>
    </sc-if>
    <sc-if value="{{ prIsMember }}" hint-placeholder-val="{{ false }}">
    <div style="font-size:13px;font-weight:700;color:#16233b">{{ prCompany }}</div>
    <div style="font-size:12px;color:#68758d;margin-top:2px">Cert {{ prCert }} · Base {{ prBase }} · managed by your team admin</div>
    </sc-if>

    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin:18px 0 6px">FLEET · AS LISTED ON YOUR D085</div>
    <sc-for list="{{ prFleet }}" as="a" hint-placeholder-count="2">
      <div style="border:1.5px solid #e3e9f2;border-radius:10px;padding:9px 11px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="min-width:0;display:flex;align-items:center;gap:8px">
            <sc-if value="{{ a.hasPhoto }}" hint-placeholder-val="{{ false }}">
            <img src="{{ a.photoUrl }}" style="width:46px;height:32px;object-fit:cover;border-radius:6px;flex-shrink:0">
            </sc-if>
            <span style="min-width:0"><span style="font-family:ui-monospace,Menlo,monospace;font-weight:800;font-size:12.5px;color:#16233b">{{ a.tail }}</span> <span style="font-size:12.5px;color:#4a5a76;font-weight:600">{{ a.model }}</span></span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <span style="font-size:9.5px;font-weight:800;letter-spacing:.5px;padding:2px 8px;border-radius:999px;background:{{ a.statusBg }};color:{{ a.statusFg }}">{{ a.status }}</span>
            <sc-if value="{{ a.showRemove }}" hint-placeholder-val="{{ false }}">
            <button sc-camel-on-click="{{ a.onRemove }}" style="border:none;background:#eef2f8;border-radius:6px;width:20px;height:20px;cursor:pointer;font-size:10px;color:#4a5a76;padding:0">✕</button>
            </sc-if>
          </div>
        </div>
        <sc-if value="{{ a.faaInfo }}" hint-placeholder-val="{{ false }}">
        <div style="font-size:11px;color:#8593ab;margin-top:3px">{{ a.faaInfo }}</div>
        </sc-if>
        <sc-if value="{{ a.canPhoto }}" hint-placeholder-val="{{ false }}">
        <label style="display:inline-block;cursor:pointer;margin-top:5px;font-size:10.5px;font-weight:800;color:#2E6BE6">{{ a.photoLabel }}<input type="file" accept="image/jpeg,image/png,image/webp" sc-camel-on-change="{{ a.onPhotoFile }}" style="display:none"></label>
        </sc-if>
      </div>
    </sc-for>
    <sc-if value="{{ prIsAdmin }}" hint-placeholder-val="{{ false }}">
    <div style="display:flex;gap:6px;margin-top:2px">
      <input value="{{ prTail }}" sc-camel-on-change="{{ onPrTail }}" placeholder="N-number" style="width:110px;border:1.5px solid #dde5f0;border-radius:9px;padding:8px 10px;font-size:12.5px">
      <input value="{{ prModel }}" sc-camel-on-change="{{ onPrModel }}" placeholder="Model (e.g. Challenger 350)" style="flex:1;min-width:0;border:1.5px solid #dde5f0;border-radius:9px;padding:8px 10px;font-size:12.5px">
      <button sc-camel-on-click="{{ addAircraft }}" style="border:none;cursor:pointer;background:#16233b;color:#fff;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700">Add</button>
    </div>
    <sc-if value="{{ prHasFleet }}" hint-placeholder-val="{{ false }}">
    <button sc-camel-on-click="{{ runFaaCheck }}" style="width:100%;margin-top:8px;border:none;cursor:pointer;background:#2E6BE6;color:#fff;border-radius:9px;padding:10px;font-size:13px;font-weight:800">Run FAA registry check</button>
    </sc-if>
    </sc-if>

    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin:18px 0 6px">AIR CARRIER CERTIFICATE</div>
    <sc-if value="{{ hasCertDoc }}" hint-placeholder-val="{{ false }}">
    <a href="/api/operator/certificate" target="_blank" style="display:flex;align-items:center;gap:8px;text-decoration:none;border:1.5px solid #dde5f0;background:#fff;border-radius:10px;padding:9px 11px;margin-bottom:6px">
      <div style="font-size:15px">📄</div>
      <div style="flex:1;min-width:0;font-size:12.5px;font-weight:700;color:#16233b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ certDocName }}</div>
      <div style="font-size:11.5px;font-weight:800;color:#2E6BE6">Open</div>
    </a>
    </sc-if>
    <sc-if value="{{ prIsAdmin }}" hint-placeholder-val="{{ false }}">
    <label style="display:block;cursor:pointer;border:1.5px dashed #b9c8e0;border-radius:10px;padding:9px;text-align:center;font-size:12px;font-weight:700;color:#2E6BE6;background:#fff">
      Upload certificate (PDF)
      <input type="file" accept=".pdf,application/pdf" sc-camel-on-change="{{ onCertDocFile }}" style="display:none">
    </label>
    </sc-if>

    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin:18px 0 6px">D085 OPSPEC (AIRCRAFT LISTING)</div>
    <sc-if value="{{ hasD085 }}" hint-placeholder-val="{{ false }}">
    <a href="/api/operator/d085" target="_blank" style="display:flex;align-items:center;gap:8px;text-decoration:none;border:1.5px solid #dde5f0;background:#fff;border-radius:10px;padding:9px 11px;margin-bottom:6px">
      <div style="font-size:15px">📄</div>
      <div style="flex:1;min-width:0;font-size:12.5px;font-weight:700;color:#16233b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ d085Name }}</div>
      <div style="font-size:11.5px;font-weight:800;color:#2E6BE6">Open</div>
    </a>
    </sc-if>
    <sc-if value="{{ prIsAdmin }}" hint-placeholder-val="{{ false }}">
    <label style="display:block;cursor:pointer;border:1.5px dashed #b9c8e0;border-radius:10px;padding:9px;text-align:center;font-size:12px;font-weight:700;color:#2E6BE6;background:#fff">
      Upload D085 (PDF)
      <input type="file" accept=".pdf,application/pdf" sc-camel-on-change="{{ onD085File }}" style="display:none">
    </label>
    </sc-if>

    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin:18px 0 6px">TEAM</div>
    <sc-for list="{{ teamMembers }}" as="u" hint-placeholder-count="2">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border:1.5px solid #e3e9f2;border-radius:10px;padding:8px 11px;margin-bottom:6px">
        <div style="min-width:0">
          <div style="font-size:12.5px;font-weight:700;color:#16233b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ u.name }}</div>
          <div style="font-size:11px;color:#8593ab;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ u.email }}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span style="font-size:9.5px;font-weight:800;letter-spacing:.5px;padding:2px 8px;border-radius:999px;background:{{ u.roleBg }};color:{{ u.roleFg }}">{{ u.roleLabel }}</span>
          <sc-if value="{{ u.canRemove }}" hint-placeholder-val="{{ false }}">
          <button sc-camel-on-click="{{ u.onRemove }}" style="border:none;background:#fdecec;color:#b3261e;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:10px;font-weight:800">Remove</button>
          </sc-if>
        </div>
      </div>
    </sc-for>
    <sc-if value="{{ hasInvites }}" hint-placeholder-val="{{ false }}">
    <sc-for list="{{ teamInvites }}" as="i" hint-placeholder-count="1">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border:1.5px dashed #b9c8e0;border-radius:10px;padding:8px 11px;margin-bottom:6px">
        <div style="font-family:ui-monospace,Menlo,monospace;font-weight:800;font-size:12.5px;color:#2E6BE6">{{ i.code }}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10.5px;color:#8593ab;font-weight:600">unused invite</span>
          <button sc-camel-on-click="{{ i.onRevoke }}" style="border:none;background:#eef2f8;color:#4a5a76;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:10px;font-weight:800">Revoke</button>
        </div>
      </div>
    </sc-for>
    </sc-if>
    <sc-if value="{{ prIsAdmin }}" hint-placeholder-val="{{ false }}">
    <button sc-camel-on-click="{{ createInvite }}" style="width:100%;border:1.5px solid #dde5f0;cursor:pointer;background:#fff;color:#16233b;border-radius:9px;padding:9px;font-size:12.5px;font-weight:700">+ Create invite code</button>
    <div style="margin-top:6px;font-size:11px;color:#8593ab;line-height:1.5">Teammates register as operators with your invite code and join this company — they can bid and message under your profile, while only you can edit the company, fleet, plan, and team.</div>
    </sc-if>

    <div style="margin-top:10px;font-size:11px;color:#8593ab;line-height:1.5">Tail numbers are checked live against the FAA aircraft registry. Your D085 is kept on file so travelers know your fleet listing matches your operating certificate — holding a Part 135 certificate is what distinguishes an operator from a broker.</div>
    <sc-if value="{{ prMsg }}" hint-placeholder-val="{{ false }}">
    <div style="margin-top:8px;font-size:12px;color:#2E6BE6;font-weight:600">{{ prMsg }}</div>
    </sc-if>
  </div>
</div>
</sc-if>
`;

if (!newTemplate.includes('{{ safetyOpts }}')) {
  const pmStart = newTemplate.indexOf('<sc-if value="{{ profileOpen }}"');
  const xdc = newTemplate.indexOf('</x-dc>');
  if (pmStart === -1 || xdc === -1 || pmStart > xdc) throw new Error('profile modal not found for replacement');
  const oldBlock = newTemplate.slice(pmStart, xdc);
  if (!oldBlock.includes('Operator profile')) throw new Error('unexpected content in profile modal slice');
  newTemplate = newTemplate.slice(0, pmStart) + MODAL_V2 + newTemplate.slice(xdc);
  console.log('applied profile-modal markup patch (team + safety + photos)');
}

// Quote cards: show the operator's uploaded aircraft photo over the placeholder.
const PHOTO_PLACEHOLDER = '<span style="font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#8593ab">aircraft photo</span>';
if (!newTemplate.includes('{{ q.photo }}')) {
  if (!newTemplate.includes(PHOTO_PLACEHOLDER)) throw new Error('aircraft photo placeholder not found — template changed?');
  newTemplate = newTemplate.replace(PHOTO_PLACEHOLDER,
    PHOTO_PLACEHOLDER + '\n                <sc-if value="{{ q.photo }}" hint-placeholder-val="{{ false }}">\n'
    + '                <img src="{{ q.photo }}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">\n'
    + '                </sc-if>');
  console.log('applied quote-card aircraft-photo markup patch');
}

// Accepted banner: point the traveler to messaging, not a phantom email.
const BANNER_OLD = '<b>Quote accepted.</b> {{ acceptedText }} — contract &amp; payment link sent to your email.';
const BANNER_NEW = '<b>Quote accepted.</b> {{ acceptedText }} — message the operator to finalize contract &amp; payment.';
if (newTemplate.includes(BANNER_OLD)) {
  newTemplate = newTemplate.replace(BANNER_OLD, BANNER_NEW);
  console.log('applied accepted-banner wording patch');
}

// Post-trip review card, shown under the accepted banner: star picker + text.
const BANNER_ANCHOR = '<b>Quote accepted.</b> {{ acceptedText }} — message the operator to finalize contract &amp; payment.</div>\n          </div>';
const REVIEW_CARD = BANNER_ANCHOR + `
          <div style="margin-top:10px;background:#fff;border:1.5px solid #e3e9f2;border-radius:14px;padding:14px 16px">
            <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:#8593ab;margin-bottom:4px">{{ rvTitle }}</div>
            <div style="display:flex;gap:2px;margin-bottom:8px">
              <sc-for list="{{ rvStarsList }}" as="st" hint-placeholder-count="5">
                <button sc-camel-on-click="{{ st.onPick }}" style="border:none;background:none;cursor:pointer;font-size:22px;line-height:1;padding:0 2px;color:{{ st.color }}">★</button>
              </sc-for>
            </div>
            <div style="display:flex;gap:8px">
              <input value="{{ rvText }}" sc-camel-on-change="{{ onRvText }}" placeholder="How was the flight? (optional)" style="flex:1;min-width:0;border:1.5px solid #dde5f0;border-radius:9px;padding:8px 10px;font-size:12.5px">
              <button sc-camel-on-click="{{ submitReview }}" style="border:none;cursor:pointer;background:#16233b;color:#fff;border-radius:9px;padding:8px 14px;font-size:12px;font-weight:700;flex-shrink:0">{{ rvBtnLabel }}</button>
            </div>
            <sc-if value="{{ rvMsg }}" hint-placeholder-val="{{ false }}">
            <div style="margin-top:6px;font-size:12px;color:#2E6BE6;font-weight:600">{{ rvMsg }}</div>
            </sc-if>
          </div>`;

if (!newTemplate.includes('{{ rvStarsList }}')) {
  if (!newTemplate.includes(BANNER_ANCHOR)) throw new Error('accepted banner anchor not found — template changed?');
  newTemplate = newTemplate.replace(BANNER_ANCHOR, REVIEW_CARD);
  console.log('applied post-trip review markup patch');
}

// Ratings come from real reviews now — relabel "trips".
const TRIPS_OLD = '({{ q.reviews }} trips)';
if (newTemplate.includes(TRIPS_OLD)) {
  newTemplate = newTemplate.replace(TRIPS_OLD, '({{ q.reviews }} reviews)');
  console.log('applied reviews-label markup patch');
}

// Trip lifecycle: banner text becomes a status-aware binding with a client
// cancel link; the review card only shows when reviewable; the chat drawer
// gets TRIP controls for the winning operator.
const BANNER_TEXT_OLD = '<b>Quote accepted.</b> {{ acceptedText }} — message the operator to finalize contract &amp; payment.</div>';
if (!newTemplate.includes('{{ bannerText }}')) {
  if (!newTemplate.includes(BANNER_TEXT_OLD)) throw new Error('banner text anchor not found — template changed?');
  newTemplate = newTemplate.replace(BANNER_TEXT_OLD,
    '{{ bannerText }} <sc-if value="{{ clientCanCancel }}" hint-placeholder-val="{{ false }}">'
    + '<button sc-camel-on-click="{{ clientCancelTrip }}" style="margin-left:6px;border:none;background:none;cursor:pointer;color:#b3261e;font-size:11.5px;font-weight:800;text-decoration:underline;padding:0">Cancel trip</button>'
    + '</sc-if></div>');
  console.log('applied trip-status banner markup patch');
}

const RC_OPEN = '<div style="margin-top:10px;background:#fff;border:1.5px solid #e3e9f2;border-radius:14px;padding:14px 16px">\n            <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:#8593ab;margin-bottom:4px">{{ rvTitle }}</div>';
const RC_TAIL = '<sc-if value="{{ rvMsg }}" hint-placeholder-val="{{ false }}">\n            <div style="margin-top:6px;font-size:12px;color:#2E6BE6;font-weight:600">{{ rvMsg }}</div>\n            </sc-if>\n          </div>';
if (!newTemplate.includes('{{ canReview }}')) {
  if (!newTemplate.includes(RC_OPEN) || !newTemplate.includes(RC_TAIL)) throw new Error('review card anchors not found — template changed?');
  newTemplate = newTemplate.replace(RC_OPEN, '<sc-if value="{{ canReview }}" hint-placeholder-val="{{ false }}">\n          ' + RC_OPEN);
  newTemplate = newTemplate.replace(RC_TAIL, RC_TAIL + '\n          </sc-if>');
  console.log('applied review-gating markup patch');
}

const CT_OPEN = '<sc-if value="{{ ctShow }}" hint-placeholder-val="{{ false }}">';
const TRIP_SECTION = `<sc-if value="{{ tripShow }}" hint-placeholder-val="{{ false }}">
      <div style="padding:12px 16px;border-bottom:1px solid #eaeff6;background:#f8fafd">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;color:#8593ab;margin-bottom:6px">TRIP</div>
        <div style="font-size:12px;color:#4a5a76;font-weight:600;margin-bottom:7px">{{ tripStatusLabel }}</div>
        <div style="display:flex;gap:6px">
          <sc-if value="{{ tripCanConfirm }}" hint-placeholder-val="{{ false }}">
          <button sc-camel-on-click="{{ tripConfirm }}" style="flex:1;border:none;cursor:pointer;background:#2E6BE6;color:#fff;border-radius:8px;padding:8px;font-size:12px;font-weight:800">Confirm trip</button>
          </sc-if>
          <sc-if value="{{ tripCanComplete }}" hint-placeholder-val="{{ false }}">
          <button sc-camel-on-click="{{ tripComplete }}" style="flex:1;border:none;cursor:pointer;background:#38a169;color:#fff;border-radius:8px;padding:8px;font-size:12px;font-weight:800">Mark completed</button>
          </sc-if>
          <sc-if value="{{ tripCanCancel }}" hint-placeholder-val="{{ false }}">
          <button sc-camel-on-click="{{ tripCancel }}" style="border:1.5px solid #f1c6c2;cursor:pointer;background:#fff;color:#b3261e;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:800">Cancel</button>
          </sc-if>
        </div>
      </div>
      </sc-if>
      ` + CT_OPEN;
if (!newTemplate.includes('{{ tripShow }}')) {
  const copies = newTemplate.split(CT_OPEN).length - 1;
  if (copies < 1) throw new Error('contract section anchor not found — template changed?');
  newTemplate = newTemplate.split(CT_OPEN).join(TRIP_SECTION);
  console.log('applied drawer TRIP controls to ' + copies + ' drawer cop' + (copies === 1 ? 'y' : 'ies'));
}

// ---- Empty-leg board ----

// Client nav: Empty legs tab with deal count.
const NAV_QUOTES_END = '<span style="background:#2E6BE6;color:#fff;font-size:11px;font-weight:700;border-radius:999px;padding:1px 7px">{{ myRequestCount }}</span>\n        </button>';
if (!newTemplate.includes('{{ goDeals }}')) {
  if (!newTemplate.includes(NAV_QUOTES_END)) throw new Error('client nav anchor not found — template changed?');
  newTemplate = newTemplate.replace(NAV_QUOTES_END, NAV_QUOTES_END + `
        <button sc-camel-on-click="{{ goDeals }}" style="display:flex;align-items:center;gap:7px;border:none;cursor:pointer;padding:8px 14px;border-radius:8px;font-size:13.5px;font-weight:600;background:{{ navDealBg }};color:{{ navDealFg }}">Empty legs
          <span style="background:#8a6d1f;color:#fff;font-size:11px;font-weight:700;border-radius:999px;padding:1px 7px">{{ dealCount }}</span>
        </button>`);
  console.log('applied empty-legs nav markup patch');
}

// Client deals screen.
const OP_SCREEN_COMMENT = '<!-- ============ OPERATOR: BID DESK ============ -->';
const DEALS_SCREEN = `<sc-if value="{{ showDeals }}" hint-placeholder-val="{{ false }}">
  <div data-screen-label="Client — Empty legs" style="flex:1;overflow-y:auto;padding:24px 28px 60px;min-height:0">
    <div style="max-width:1020px;margin:0 auto">
      <h1 style="margin:0;font-size:22px;font-weight:800;color:#16233b">Empty-leg deals</h1>
      <div style="color:#68758d;font-size:13.5px;margin-top:4px">Repositioning flights listed by operators — deep discounts on fixed routes and dates.</div>
      <sc-if value="{{ hasDeals }}" hint-placeholder-val="{{ false }}">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:20px">
        <sc-for list="{{ dealCards }}" as="d" hint-placeholder-count="3">
          <div style="background:#fff;border:1.5px solid #e3e9f2;border-radius:16px;padding:16px;display:flex;flex-direction:column">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
              <div style="font-family:ui-monospace,Menlo,monospace;font-weight:800;font-size:18px;color:#16233b">{{ d.route }}</div>
              <div style="font-size:10px;font-weight:800;letter-spacing:.5px;color:#8a6d1f;background:#fdf6e3;border-radius:999px;padding:2px 9px;flex-shrink:0">EMPTY LEG</div>
            </div>
            <div style="font-size:12.5px;color:#68758d;margin-top:3px">{{ d.when }}</div>
            <sc-if value="{{ d.photo }}" hint-placeholder-val="{{ false }}">
            <div style="height:110px;border-radius:10px;overflow:hidden;margin-top:10px"><img src="{{ d.photo }}" style="width:100%;height:100%;object-fit:cover"></div>
            </sc-if>
            <div style="font-size:12.5px;color:#4a5a76;font-weight:700;margin-top:10px">{{ d.aircraft }}</div>
            <div style="font-size:12px;color:#68758d;margin-top:2px">{{ d.opLine }}</div>
            <sc-if value="{{ d.note }}" hint-placeholder-val="{{ false }}">
            <div style="font-size:12px;color:#8593ab;font-style:italic;margin-top:6px">{{ d.note }}</div>
            </sc-if>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:12px">
              <div style="font-size:20px;font-weight:800;color:#16233b">{{ d.price }}</div>
              <button sc-camel-on-click="{{ d.onRequest }}" style="border:none;cursor:pointer;background:#2E6BE6;color:#fff;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:800">Request this flight</button>
            </div>
          </div>
        </sc-for>
      </div>
      </sc-if>
      <sc-if value="{{ noDeals }}" hint-placeholder-val="{{ false }}">
      <div style="margin-top:26px;border:1.5px dashed #c6d2e6;border-radius:16px;padding:36px;text-align:center;color:#8593ab;font-size:13.5px">No empty legs listed right now — check back soon.</div>
      </sc-if>
    </div>
  </div>
  </sc-if>

  ` + OP_SCREEN_COMMENT;
if (!newTemplate.includes('{{ dealCards }}')) {
  if (!newTemplate.includes(OP_SCREEN_COMMENT)) throw new Error('operator screen comment not found — template changed?');
  newTemplate = newTemplate.replace(OP_SCREEN_COMMENT, DEALS_SCREEN);
  console.log('applied empty-legs board markup patch');
}

// Operator sidebar: MY EMPTY LEGS list + post button.
const SIDEBAR_TAIL = '</div>\n    <div style="overflow-y:auto;padding:22px 26px 60px">';
const LEGS_SECTION = `  <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#8593ab;padding:18px 6px 10px">MY EMPTY LEGS</div>
      <sc-for list="{{ myLegs }}" as="l" hint-placeholder-count="1">
        <div style="border:1.5px solid #e3e9f2;border-radius:12px;padding:10px 12px;margin-bottom:8px;background:#fff">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div style="font-family:ui-monospace,Menlo,monospace;font-weight:800;font-size:12.5px;color:#16233b">{{ l.route }}</div>
            <button sc-camel-on-click="{{ l.onRemove }}" style="border:none;background:#eef2f8;border-radius:6px;width:20px;height:20px;cursor:pointer;font-size:10px;color:#4a5a76;padding:0">✕</button>
          </div>
          <div style="font-size:11.5px;color:#68758d;margin-top:2px">{{ l.sub }}</div>
        </div>
      </sc-for>
      <button sc-camel-on-click="{{ openLegForm }}" style="width:100%;border:1.5px dashed #b9c8e0;cursor:pointer;background:#fff;color:#2E6BE6;border-radius:10px;padding:9px;font-size:12px;font-weight:800">+ Post empty leg</button>
    </div>
    <div style="overflow-y:auto;padding:22px 26px 60px">`;
if (!newTemplate.includes('{{ myLegs }}')) {
  if (!newTemplate.includes(SIDEBAR_TAIL)) throw new Error('operator sidebar tail not found — template changed?');
  newTemplate = newTemplate.replace(SIDEBAR_TAIL, LEGS_SECTION);
  console.log('applied my-empty-legs sidebar markup patch');
}

// Operator: post-empty-leg modal.
const LEG_MODAL = `<sc-if value="{{ legFormOpen }}" hint-placeholder-val="{{ false }}">
<div style="position:fixed;inset:0;background:rgba(10,20,40,.55);display:flex;align-items:center;justify-content:center;z-index:3000">
  <div style="background:#fff;border-radius:18px;padding:24px;width:400px;max-width:94vw;box-shadow:0 24px 60px rgba(10,30,80,.35)">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:18px;font-weight:800;color:#16233b">Post an empty leg</div>
      <button sc-camel-on-click="{{ closeLegForm }}" style="border:none;background:#eef2f8;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:13px;color:#4a5a76">✕</button>
    </div>
    <div style="display:flex;gap:7px;margin-top:14px">
      <input value="{{ legFrom }}" sc-camel-on-change="{{ onLegFrom }}" placeholder="From (TEB)" style="flex:1;min-width:0;border:1.5px solid #dde5f0;border-radius:9px;padding:9px 11px;font-size:13px;text-transform:uppercase">
      <input value="{{ legTo }}" sc-camel-on-change="{{ onLegTo }}" placeholder="To (PBI)" style="flex:1;min-width:0;border:1.5px solid #dde5f0;border-radius:9px;padding:9px 11px;font-size:13px;text-transform:uppercase">
    </div>
    <div style="display:flex;gap:7px;margin-top:7px">
      <input type="date" value="{{ legDate }}" sc-camel-on-change="{{ onLegDate }}" style="flex:1;min-width:0;border:1.5px solid #dde5f0;border-radius:9px;padding:8px 11px;font-size:13px">
      <input type="time" value="{{ legTime }}" sc-camel-on-change="{{ onLegTime }}" style="width:110px;border:1.5px solid #dde5f0;border-radius:9px;padding:8px 11px;font-size:13px">
    </div>
    <sc-raw-select value="{{ legAircraft }}" sc-camel-on-change="{{ onLegAircraft }}" style="width:100%;margin-top:7px;border:1.5px solid #dde5f0;border-radius:9px;padding:9px 10px;font-size:13px;background:#fff;color:#16233b">
      <sc-for list="{{ fleet }}" as="f" hint-placeholder-count="4">
        <option value="{{ f.id }}">{{ f.label }}</option>
      </sc-for>
    </sc-raw-select>
    <input value="{{ legPrice }}" sc-camel-on-change="{{ onLegPrice }}" placeholder="All-in price (e.g. 9,500)" style="width:100%;box-sizing:border-box;margin-top:7px;border:1.5px solid #dde5f0;border-radius:9px;padding:9px 11px;font-size:13px;font-weight:700">
    <input value="{{ legNote }}" sc-camel-on-change="{{ onLegNote }}" placeholder="Note (optional — e.g. repositioning after a charter)" style="width:100%;box-sizing:border-box;margin-top:7px;border:1.5px solid #dde5f0;border-radius:9px;padding:9px 11px;font-size:12.5px">
    <button sc-camel-on-click="{{ postEmptyLeg }}" style="width:100%;margin-top:12px;border:none;cursor:pointer;background:#2E6BE6;color:#fff;border-radius:10px;padding:11px;font-size:13.5px;font-weight:800">Post to the board</button>
    <sc-if value="{{ legMsg }}" hint-placeholder-val="{{ false }}">
    <div style="margin-top:8px;font-size:12px;color:#b3261e;font-weight:600">{{ legMsg }}</div>
    </sc-if>
  </div>
</div>
</sc-if>
</x-dc>`;
if (!newTemplate.includes('{{ legFormOpen }}')) {
  if (!newTemplate.includes('</x-dc>')) throw new Error('x-dc close not found — template changed?');
  newTemplate = newTemplate.replace('</x-dc>', LEG_MODAL);
  console.log('applied empty-leg modal markup patch');
}

// Deposit-model patches: hold-confirmation modal, close-request action, and
// the operator anonymity notice in the chat drawer.
const DEPOSIT_MODAL = `<sc-if value="{{ depOpen }}" hint-placeholder-val="{{ false }}">
<div style="position:fixed;inset:0;background:rgba(10,20,40,.55);display:flex;align-items:center;justify-content:center;z-index:3000">
  <div style="background:#fff;border-radius:18px;padding:28px;width:380px;max-width:94vw;box-shadow:0 24px 60px rgba(10,30,80,.35)">
    <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#2E6BE6">REQUEST DEPOSIT</div>
    <div style="font-size:28px;font-weight:800;color:#16233b;margin-top:8px">{{ depAmountText }}</div>
    <div style="font-size:13px;color:#4a5a76;line-height:1.55;margin-top:10px">A fully refundable hold placed when your request goes out. <b>Refunded 100%</b> if no operator can fly it or none of the quotes work for you — it only becomes the platform fee when you accept a quote.</div>
    <div style="margin-top:14px;padding:10px 12px;background:#fdf6e3;border-radius:10px;font-size:12px;color:#8a6d1f;font-weight:600;line-height:1.45">Demo mode — no payment is processed and no card is required.</div>
    <button sc-camel-on-click="{{ confirmDeposit }}" style="width:100%;margin-top:14px;border:none;cursor:pointer;background:#2E6BE6;color:#fff;border-radius:10px;padding:12px;font-size:14px;font-weight:800">Place hold &amp; send request</button>
    <button sc-camel-on-click="{{ cancelDeposit }}" style="width:100%;margin-top:8px;border:none;cursor:pointer;background:#eef2f8;color:#4a5a76;border-radius:10px;padding:10px;font-size:13px;font-weight:700">Cancel</button>
  </div>
</div>
</sc-if>
</x-dc>`;
if (!newTemplate.includes('{{ depOpen }}')) {
  if (!newTemplate.includes('</x-dc>')) throw new Error('x-dc close not found — template changed?');
  newTemplate = newTemplate.replace('</x-dc>', DEPOSIT_MODAL);
  console.log('applied deposit-modal markup patch');
}

const ACCEPTED_IF = '<sc-if value="{{ hasAccepted }}" hint-placeholder-val="{{ false }}">';
if (!newTemplate.includes('{{ canClose }}')) {
  if (!newTemplate.includes(ACCEPTED_IF)) throw new Error('hasAccepted anchor not found — template changed?');
  newTemplate = newTemplate.replace(ACCEPTED_IF,
    `<sc-if value="{{ canClose }}" hint-placeholder-val="{{ false }}">
        <button sc-camel-on-click="{{ closeActiveRequest }}" style="margin-top:14px;border:1.5px solid #dde5f0;cursor:pointer;background:#fff;color:#68758d;border-radius:10px;padding:9px 14px;font-size:12.5px;font-weight:700">{{ closeLabel }}</button>
        </sc-if>
        ` + ACCEPTED_IF);
  console.log('applied close-request markup patch');
}

const TRIP_IF = '<sc-if value="{{ tripShow }}" hint-placeholder-val="{{ false }}">';
const ANON_NOTE = `<sc-if value="{{ opAnonNote }}" hint-placeholder-val="{{ false }}">
      <div style="padding:9px 16px;border-bottom:1px solid #eaeff6;background:#fdf6e3;font-size:11.5px;color:#8a6d1f;font-weight:600;line-height:1.45">You're anonymous to this client until they accept your quote — don't share your company name or contact details. Contact info in messages is hidden automatically.</div>
      </sc-if>
      ` + TRIP_IF;
if (!newTemplate.includes('{{ opAnonNote }}')) {
  const copies = newTemplate.split(TRIP_IF).length - 1;
  if (copies < 1) throw new Error('trip section anchor not found — template changed?');
  newTemplate = newTemplate.split(TRIP_IF).join(ANON_NOTE);
  console.log('applied operator-anonymity-notice patch to ' + copies + ' drawer cop' + (copies === 1 ? 'y' : 'ies'));
}

// ---- Operator analytics ----

// Nav: Bid desk / Analytics tabs replace the static operator label.
const OP_NAV_OLD = `<span style="padding:8px 14px;font-size:13.5px;font-weight:600;color:#16233b">Bid desk</span>
        <span style="padding:8px 0;font-size:13px;color:#8593ab">{{ openRfqCount }} open requests · sealed bidding</span>`;
if (!newTemplate.includes('{{ goStats }}')) {
  if (!newTemplate.includes(OP_NAV_OLD)) throw new Error('operator nav anchor not found — template changed?');
  newTemplate = newTemplate.replace(OP_NAV_OLD,
    `<button sc-camel-on-click="{{ goDesk }}" style="display:flex;align-items:center;gap:7px;border:none;cursor:pointer;padding:8px 14px;border-radius:8px;font-size:13.5px;font-weight:600;background:{{ navDeskBg }};color:{{ navDeskFg }}">Bid desk
          <span style="background:#2E6BE6;color:#fff;font-size:11px;font-weight:700;border-radius:999px;padding:1px 7px">{{ openRfqCount }}</span>
        </button>
        <button sc-camel-on-click="{{ goStats }}" style="border:none;cursor:pointer;padding:8px 14px;border-radius:8px;font-size:13.5px;font-weight:600;background:{{ navStatBg }};color:{{ navStatFg }}">Analytics</button>`);
  console.log('applied operator-nav tabs markup patch');
}

// Analytics screen: stat tiles, won-trip expense entry with margins, and an
// admin-only member breakdown.
const CHECKOUT_IF = '<sc-if value="{{ checkoutOpen }}"';
const STATS_SCREEN = `<sc-if value="{{ showOpStats }}" hint-placeholder-val="{{ false }}">
  <div data-screen-label="Operator — Analytics" style="flex:1;overflow-y:auto;padding:24px 28px 60px;min-height:0">
    <div style="max-width:960px;margin:0 auto">
      <h1 style="margin:0;font-size:22px;font-weight:800;color:#16233b">Sales analytics</h1>
      <div style="color:#68758d;font-size:13.5px;margin-top:4px">Your team's quoting, wins, revenue, and margins — cancelled trips excluded.</div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:20px">
        <sc-for list="{{ stTiles }}" as="t" hint-placeholder-count="7">
          <div style="background:#fff;border:1.5px solid #e3e9f2;border-radius:14px;padding:14px 16px">
            <div style="font-size:9.5px;font-weight:800;letter-spacing:1px;color:#8593ab">{{ t.label }}</div>
            <div style="font-size:20px;font-weight:800;color:#16233b;margin-top:4px">{{ t.value }}</div>
          </div>
        </sc-for>
      </div>
      <sc-if value="{{ expNote }}" hint-placeholder-val="{{ false }}">
      <div style="margin-top:10px;padding:9px 13px;background:#fdf6e3;border-radius:10px;font-size:12px;color:#8a6d1f;font-weight:600">{{ expNote }}</div>
      </sc-if>

      <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#8593ab;margin:26px 0 10px">WON TRIPS · ENTER COSTS FOR MARGINS</div>
      <sc-if value="{{ hasTrips }}" hint-placeholder-val="{{ false }}">
      <sc-for list="{{ tripRows }}" as="t" hint-placeholder-count="2">
        <div style="background:#fff;border:1.5px solid #e3e9f2;border-radius:14px;padding:14px 16px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="min-width:0">
              <span style="font-family:ui-monospace,Menlo,monospace;font-weight:800;font-size:15px;color:#16233b">{{ t.route }}</span>
              <span style="font-size:12px;color:#8593ab;margin-left:8px">{{ t.rid }}</span>
              <span style="font-size:9.5px;font-weight:800;letter-spacing:.5px;padding:2px 8px;border-radius:999px;background:{{ t.statusBg }};color:{{ t.statusFg }};margin-left:8px">{{ t.status }}</span>
              <div style="font-size:12px;color:#68758d;margin-top:3px">{{ t.sub }}</div>
            </div>
            <div style="font-size:18px;font-weight:800;color:#16233b">{{ t.price }}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:800;letter-spacing:.5px;color:#8593ab">EXPENSES $</span>
            <input value="{{ t.expVal }}" sc-camel-on-change="{{ t.onExp }}" placeholder="e.g. 9,800" style="width:120px;border:1.5px solid #dde5f0;border-radius:8px;padding:7px 10px;font-size:12.5px;font-weight:700">
            <button sc-camel-on-click="{{ t.saveExp }}" style="border:none;cursor:pointer;background:#16233b;color:#fff;border-radius:8px;padding:7px 13px;font-size:12px;font-weight:700">Save</button>
            <span style="font-size:12.5px;font-weight:700;color:{{ t.profitColor }}">{{ t.profitText }}</span>
          </div>
        </div>
      </sc-for>
      </sc-if>
      <sc-if value="{{ noTrips }}" hint-placeholder-val="{{ false }}">
      <div style="border:1.5px dashed #c6d2e6;border-radius:14px;padding:28px;text-align:center;color:#8593ab;font-size:13px">No won trips yet — win a request and it lands here.</div>
      </sc-if>
      <sc-if value="{{ expMsg }}" hint-placeholder-val="{{ false }}">
      <div style="margin-top:4px;font-size:12px;color:#2E6BE6;font-weight:600">{{ expMsg }}</div>
      </sc-if>

      <sc-if value="{{ showMembers }}" hint-placeholder-val="{{ false }}">
      <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#8593ab;margin:26px 0 10px">TEAM PERFORMANCE</div>
      <sc-for list="{{ memberRows }}" as="m" hint-placeholder-count="2">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff;border:1.5px solid #e3e9f2;border-radius:12px;padding:12px 16px;margin-bottom:8px;flex-wrap:wrap">
          <div style="min-width:0">
            <div style="font-size:13.5px;font-weight:800;color:#16233b">{{ m.name }}</div>
            <div style="font-size:12px;color:#68758d;margin-top:2px">{{ m.sub }}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:15px;font-weight:800;color:#16233b">{{ m.revenue }}</div>
            <div style="font-size:12px;color:#1e5e3c;font-weight:700">{{ m.profit }}</div>
          </div>
        </div>
      </sc-for>
      </sc-if>
    </div>
  </div>
  </sc-if>
  ` + CHECKOUT_IF;
if (!newTemplate.includes('{{ showOpStats }}')) {
  if (!newTemplate.includes(CHECKOUT_IF)) throw new Error('checkout modal anchor not found — template changed?');
  newTemplate = newTemplate.replace(CHECKOUT_IF, STATS_SCREEN);
  console.log('applied operator-analytics screen markup patch');
}

// Demo checkout modal (global overlay, both roles).
const CHECKOUT_MODAL = `<sc-if value="{{ checkoutOpen }}" hint-placeholder-val="{{ false }}">
<div style="position:fixed;inset:0;background:rgba(10,20,40,.55);display:flex;align-items:center;justify-content:center;z-index:3000">
  <div style="background:#fff;border-radius:18px;padding:28px;width:360px;max-width:92vw;box-shadow:0 24px 60px rgba(10,30,80,.35)">
    <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#2E6BE6">{{ coTag }}</div>
    <div style="font-size:21px;font-weight:800;color:#16233b;margin-top:4px">{{ coName }}</div>
    <div style="font-size:28px;font-weight:800;color:#16233b;margin-top:10px">{{ coPrice }}<span style="font-size:13px;color:#68758d;font-weight:600"> /month</span></div>
    <div style="margin-top:12px">
      <sc-for list="{{ coFeatures }}" as="f" hint-placeholder-count="4">
        <div style="font-size:13px;color:#4a5a76;margin-top:7px">✓ {{ f.label }}</div>
      </sc-for>
    </div>
    <div style="margin-top:16px;padding:10px 12px;background:#fdf6e3;border-radius:10px;font-size:12px;color:#8a6d1f;font-weight:600;line-height:1.45">Demo mode — no payment is processed and no card is required.</div>
    <button sc-camel-on-click="{{ coComplete }}" style="width:100%;margin-top:14px;border:none;cursor:pointer;background:#2E6BE6;color:#fff;border-radius:10px;padding:12px;font-size:14px;font-weight:800">Complete demo checkout</button>
    <button sc-camel-on-click="{{ coCancel }}" style="width:100%;margin-top:8px;border:none;cursor:pointer;background:#eef2f8;color:#4a5a76;border-radius:10px;padding:10px;font-size:13px;font-weight:700">Cancel</button>
  </div>
</div>
</sc-if>
</x-dc>`;

if (!newTemplate.includes('{{ checkoutOpen }}')) {
  if (!newTemplate.includes('</x-dc>')) throw new Error('x-dc close not found — template changed?');
  newTemplate = newTemplate.replace('</x-dc>', CHECKOUT_MODAL);
  console.log('applied checkout-modal markup patch');
}

// Match the bundler's escaping: "</" must not appear raw inside a script tag.
const newJson = JSON.stringify(newTemplate).replace(/<\//g, '<\\/');

let out = html.slice(0, jsonStart) + newJson + html.slice(jsonEnd);

// ---- airports dataset (src/airports.js → bundle manifests) ----
// The airport list ships as a gzipped asset in the bundle manifest, once for
// the app document and once inside the nested Leaflet map page. Swap both.
const airportsSrc = fs.readFileSync(path.join(root, 'src', 'airports.js'), 'utf8');

// Cap the map at 25 markers: grow the clustering cell until the marker count
// (pins + clusters) fits. Applies to the nested Leaflet page's inline script.
function patchMapDoc(doc) {
  const mOpen = '<script type="__bundler/template">';
  const ms = doc.indexOf(mOpen);
  if (ms === -1) return { doc, changed: false };
  const mStart = ms + mOpen.length;
  const mEnd = doc.indexOf('</script>', mStart);
  let tpl = JSON.parse(doc.slice(mStart, mEnd));
  if (tpl.includes('vb.contains')) return { doc, changed: false }; // current version already applied
  // Only cluster airports inside the (padded) viewport — capping against the
  // whole world coarsens clusters so far their centroids leave the screen.
  const CAPPED_REBUILD = `var zoom = map.getZoom(), MAX_MARKERS = 25, cell = 74, grid = {};
  var vb = map.getBounds().pad(0.2);
  var pts = APS.filter(function(a){ return vb.contains([a.lat, a.lon]); });
  for (;;) {
    grid = {};
    pts.forEach(function(a){
      var p = map.project([a.lat, a.lon], zoom);
      var k = Math.floor(p.x/cell) + ':' + Math.floor(p.y/cell);
      (grid[k] = grid[k] || []).push(a);
    });
    if (Object.keys(grid).length <= MAX_MARKERS || cell > 60000) break;
    cell *= 1.6;
  }`;
  const reOriginal = /var zoom = map\.getZoom\(\), cell = 74, grid = \{\};\s*APS\.forEach\(function\(a\)\{[\s\S]*?\}\);/;
  const reBuggyCap = /var zoom = map\.getZoom\(\), MAX_MARKERS = 25, cell = 74, grid = \{\};[\s\S]*?cell \*= 1\.6;\s*\}/;
  if (reBuggyCap.test(tpl)) tpl = tpl.replace(reBuggyCap, CAPPED_REBUILD);
  else if (reOriginal.test(tpl)) tpl = tpl.replace(reOriginal, CAPPED_REBUILD);
  else throw new Error('map rebuild() anchor not found — map template changed?');
  const tjson = JSON.stringify(tpl).replace(/<\//g, '<\\/');
  return { doc: doc.slice(0, mStart) + tjson + doc.slice(mEnd), changed: true };
}

// Airport categories on the map: chips colored international / regional /
// private-GA / military, with a legend card in the map's bottom-left corner.
function patchMapLegend(doc) {
  const mOpen = '<script type="__bundler/template">';
  const ms = doc.indexOf(mOpen);
  if (ms === -1) return { doc, changed: false };
  const mStart = ms + mOpen.length;
  const mEnd = doc.indexOf('</script>', mStart);
  let tpl = JSON.parse(doc.slice(mStart, mEnd));
  if (!tpl.includes('.ap-cluster')) return { doc, changed: false };

  // Military airports were removed from the dataset — drop the legend row if
  // it's present from an earlier pack.
  const MIL_ROW = '  <div class="lg-row"><span class="lg-sw" style="background:#55622f;border-color:#434e24"></span>Military</div>\n';
  let touched = false;
  if (tpl.includes(MIL_ROW)) {
    tpl = tpl.replace(MIL_ROW, '');
    touched = true;
  }
  // Label refresh: amber means FAA private-use (prior permission required);
  // public GA fields fold into the regional row.
  const LABELS = [
    ['</span>Regional</div>', '</span>Regional / GA</div>'],
    ['</span>Private / GA</div>', '</span>Private (PPR)</div>'],
  ];
  for (const [from, to] of LABELS) {
    if (tpl.includes(from)) { tpl = tpl.replace(from, to); touched = true; }
  }
  if (tpl.includes('cat-i')) { // main patch already applied
    if (!touched) return { doc, changed: false };
    const tj = JSON.stringify(tpl).replace(/<\//g, '<\\/');
    return { doc: doc.slice(0, mStart) + tj + doc.slice(mEnd), changed: true };
  }

  const edits = [
    // carry the category through the map's airport objects
    ['lat:r[4], lon:r[5], tier:r[6] }; });',
     'lat:r[4], lon:r[5], tier:r[6], cat:r[7] }; });'],
    // color chips by category instead of by hub tier
    ["'<div class=\"ap-chip' + (a.tier===1?' t1':'') + (anim?' pop':'') + '\"'",
     "'<div class=\"ap-chip cat-' + (a.cat||'r') + (anim?' pop':'') + '\"'"],
    // category colors + legend styling
    ['.ap-chip.t1{background:#2E6BE6;color:#fff;bord',
     '.ap-chip.cat-i{background:#2E6BE6;color:#fff;border-color:#2458c0}\n'
     + '.ap-chip.cat-r{background:#fff;color:#16233b;border-color:#c6d2e6}\n'
     + '.ap-chip.cat-p{background:#fdf6e3;color:#8a6d1f;border-color:#e0cf9a}\n'
     + '.ap-chip.cat-m{background:#55622f;color:#fff;border-color:#434e24}\n'
     + '#legend{position:absolute;left:12px;bottom:12px;z-index:1000;background:rgba(255,255,255,.95);backdrop-filter:blur(4px);border-radius:11px;box-shadow:0 3px 12px rgba(22,35,59,.18);padding:10px 13px;font:600 11px/1.35 system-ui,sans-serif;color:#4a5a76}\n'
     + '#legend .lg-title{font-weight:800;font-size:10px;letter-spacing:.8px;color:#8593ab;margin-bottom:5px}\n'
     + '#legend .lg-row{display:flex;align-items:center;gap:7px;margin:3px 0}\n'
     + '#legend .lg-sw{width:13px;height:13px;border-radius:4px;border:1.5px solid;flex-shrink:0}\n'
     + '#legend .lg-dot{width:13px;height:13px;border-radius:50%;background:rgba(46,107,230,.92);box-shadow:0 0 0 2.5px rgba(46,107,230,.22);flex-shrink:0}\n'
     + '.ap-chip.t1{background:#2E6BE6;color:#fff;bord'],
    // legend markup
    ['<div id="map"></div>',
     '<div id="map"></div>\n<div id="legend">\n'
     + '  <div class="lg-title">AIRPORTS</div>\n'
     + '  <div class="lg-row"><span class="lg-sw" style="background:#2E6BE6;border-color:#2458c0"></span>International</div>\n'
     + '  <div class="lg-row"><span class="lg-sw" style="background:#fff;border-color:#c6d2e6"></span>Regional / GA</div>\n'
     + '  <div class="lg-row"><span class="lg-sw" style="background:#fdf6e3;border-color:#e0cf9a"></span>Private (PPR)</div>\n'
     + '  <div class="lg-row"><span class="lg-dot"></span>Multiple airports</div>\n'
     + '</div>'],
  ];
  for (const [from, to] of edits) {
    if (!tpl.includes(from)) throw new Error('legend patch anchor not found: ' + from.slice(0, 60));
    tpl = tpl.replace(from, to);
  }
  const tjson = JSON.stringify(tpl).replace(/<\//g, '<\\/');
  return { doc: doc.slice(0, mStart) + tjson + doc.slice(mEnd), changed: true };
}

// Move Leaflet's zoom +/- to the bottom-right: the app's prompt bar overlays
// the default top-left position.
function patchMapZoomPos(doc) {
  const mOpen = '<script type="__bundler/template">';
  const ms = doc.indexOf(mOpen);
  if (ms === -1) return { doc, changed: false };
  const mStart = ms + mOpen.length;
  const mEnd = doc.indexOf('</script>', mStart);
  let tpl = JSON.parse(doc.slice(mStart, mEnd));
  const OLD = "var map = L.map('map', { worldCopyJump:true }).setView([38,-30], 3);";
  if (!tpl.includes(OLD)) return { doc, changed: false };
  tpl = tpl.replace(OLD,
    "var map = L.map('map', { worldCopyJump:true, zoomControl:false }).setView([38,-30], 3);\n"
    + "L.control.zoom({ position: 'bottomright' }).addTo(map);");
  const tjson = JSON.stringify(tpl).replace(/<\//g, '<\\/');
  return { doc: doc.slice(0, mStart) + tjson + doc.slice(mEnd), changed: true };
}

// Zoom-scaled marker cap: 25 circles at world view, 5x (125) when zoomed in.
function patchMapZoomCap(doc) {
  const mOpen = '<script type="__bundler/template">';
  const ms = doc.indexOf(mOpen);
  if (ms === -1) return { doc, changed: false };
  const mStart = ms + mOpen.length;
  const mEnd = doc.indexOf('</script>', mStart);
  let tpl = JSON.parse(doc.slice(mStart, mEnd));
  let changed = false;
  const CAPS = 'MAX_MARKERS = zoom <= 4 ? 19 : zoom === 5 ? 45 : 94';
  if (tpl.includes('MAX_MARKERS = 25') && !tpl.includes('zoom <= 4 ?')) {
    tpl = tpl.replace('MAX_MARKERS = 25', CAPS);
    changed = true;
  }
  if (tpl.includes('MAX_MARKERS = zoom <= 4 ? 25 : zoom === 5 ? 60 : 125')) {
    tpl = tpl.replace('MAX_MARKERS = zoom <= 4 ? 25 : zoom === 5 ? 60 : 125', CAPS);
    changed = true;
  }
  // Finer starting cell when zoomed in — otherwise the grid never refines and
  // the higher cap goes unused.
  if (tpl.includes('cell = 74') && !tpl.includes('cell = zoom')) {
    tpl = tpl.replace('cell = 74', 'cell = zoom <= 4 ? 74 : zoom === 5 ? 55 : 36');
    changed = true;
  }
  if (!changed) return { doc, changed: false };
  const tjson = JSON.stringify(tpl).replace(/<\//g, '<\\/');
  return { doc: doc.slice(0, mStart) + tjson + doc.slice(mEnd), changed: true };
}

// Tableau-style clusters: circle size scales with sqrt(count), clicking a
// cluster flies/zooms smoothly, and markers pop in staggered when the zoom
// level changes (the "big circle breaks into smaller ones" reveal).
function patchMapTableau(doc) {
  const mOpen = '<script type="__bundler/template">';
  const ms = doc.indexOf(mOpen);
  if (ms === -1) return { doc, changed: false };
  const mStart = ms + mOpen.length;
  const mEnd = doc.indexOf('</script>', mStart);
  let tpl = JSON.parse(doc.slice(mStart, mEnd));
  if (!tpl.includes('.ap-cluster')) return { doc, changed: false };
  if (tpl.includes('__zoomAt')) return { doc, changed: false }; // current version applied

  const edits = [
    // pop-in animation CSS (preserves the centering transform)
    ['.ap-cluster div{display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(46,107,230,.92);color:#fff;font:700 12px system-ui,sans-serif;box-shadow:0 0 0 5px rgba(46,107,230,.22),0 2px 6px rgba(22,35,59,.25);transform:translate(-50%,-50%);cursor:pointer}',
     '.ap-cluster div{display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(46,107,230,.92);color:#fff;font:700 12px system-ui,sans-serif;box-shadow:0 0 0 5px rgba(46,107,230,.22),0 2px 6px rgba(22,35,59,.25);transform:translate(-50%,-50%);cursor:pointer;transition:box-shadow .15s}\n'
     + '.ap-cluster div:hover{box-shadow:0 0 0 8px rgba(46,107,230,.3),0 2px 8px rgba(22,35,59,.3)}\n'
     + '@keyframes ap-pop{0%{transform:translate(-50%,-50%) scale(.25);opacity:0}70%{transform:translate(-50%,-50%) scale(1.08);opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}\n'
     + '.ap-chip.pop,.ap-cluster div.pop{animation:ap-pop .38s cubic-bezier(.2,.8,.3,1.15) both}'],
    // animate when the zoom level changed (drill-down), not on pans; keep the
    // animation window open 700ms so the moveend rebuild right after zoomend
    // doesn't wipe the pop-in
    ['var zoom = map.getZoom(), MAX_MARKERS = 25, cell = 74, grid = {};',
     'var zoom = map.getZoom(), MAX_MARKERS = 25, cell = 74, grid = {};\n'
     + '  var nowTs = Date.now();\n'
     + '  if (window.__zoomAt === undefined || zoom !== window.__lastZoom) { window.__lastZoom = zoom; window.__zoomAt = nowTs; }\n'
     + '  var anim = (nowTs - window.__zoomAt) < 700;'],
    // upgrade path from the previous anim flag
    ['var zoom = map.getZoom(), anim = zoom !== window.__lastZoom, MAX_MARKERS = 25, cell = 74, grid = {};\n  window.__lastZoom = zoom;',
     'var zoom = map.getZoom(), MAX_MARKERS = 25, cell = 74, grid = {};\n'
     + '  var nowTs = Date.now();\n'
     + '  if (window.__zoomAt === undefined || zoom !== window.__lastZoom) { window.__lastZoom = zoom; window.__zoomAt = nowTs; }\n'
     + '  var anim = (nowTs - window.__zoomAt) < 700;'],
    // staggered pop on single-airport chips
    ["html:'<div class=\"ap-chip' + (a.tier===1?' t1':'') + '\">' + a.iata + '</div>'",
     "html:'<div class=\"ap-chip' + (a.tier===1?' t1':'') + (anim?' pop':'') + '\"' + (anim?' style=\"animation-delay:' + (Math.random()*.15).toFixed(2) + 's\"':'') + '>' + a.iata + '</div>'"],
    // Tableau sizing: area ~ count (radius ~ sqrt), font scales with the circle
    ['var n = g.length, s = n > 40 ? 46 : n > 12 ? 40 : 34;',
     'var n = g.length, s = Math.min(64, Math.round(24 + 4.5 * Math.sqrt(n))), fsz = Math.max(11, Math.min(15, Math.round(s / 3.6)));'],
    ["html:'<div style=\"width:' + s + 'px;height:' + s + 'px\">' + n + '</div>'",
     "html:'<div class=\"' + (anim?'pop':'') + '\" style=\"width:' + s + 'px;height:' + s + 'px;font-size:' + fsz + 'px' + (anim?';animation-delay:' + (Math.random()*.15).toFixed(2) + 's':'') + '\">' + n + '</div>'"],
  ];
  // These may already be applied from a previous pack — apply only when found.
  for (const [from, to] of edits) {
    if (tpl.includes(from)) tpl = tpl.replace(from, to);
  }

  // Smooth animated drill-down. When the cluster's own extent wouldn't zoom in
  // (world-view mega-clusters span the whole screen), fly toward its center by
  // two zoom levels instead so every click reveals the next layer.
  const SMART_CLICK = 'var cb = L.latLngBounds(g.map(function(a){ return [a.lat, a.lon]; })).pad(0.2); '
    + 'if (map.getBoundsZoom(cb) <= map.getZoom() + 1) { map.flyTo([lat, lon], map.getZoom() + 2, { duration: 0.8 }); } '
    + 'else { map.flyToBounds(cb, { duration: 0.8 }); }';
  const CLICK_V1 = 'map.flyToBounds(L.latLngBounds(g.map(function(a){ return [a.lat, a.lon]; })).pad(0.3), { duration: 0.8 });';
  const CLICK_ORIG = 'map.fitBounds(L.latLngBounds(g.map(function(a){ return [a.lat, a.lon]; })).pad(0.3));';
  if (tpl.includes(CLICK_V1)) tpl = tpl.replace(CLICK_V1, SMART_CLICK);
  else if (tpl.includes(CLICK_ORIG)) tpl = tpl.replace(CLICK_ORIG, SMART_CLICK);
  else if (!tpl.includes('getBoundsZoom')) throw new Error('cluster click anchor not found — map template changed?');
  const tjson = JSON.stringify(tpl).replace(/<\//g, '<\\/');
  return { doc: doc.slice(0, mStart) + tjson + doc.slice(mEnd), changed: true };
}

function swapAirports(doc) {
  const mOpen = '<script type="__bundler/manifest">';
  const ms = doc.indexOf(mOpen);
  if (ms === -1) return { doc, changed: false };
  const mStart = ms + mOpen.length;
  const mEnd = doc.indexOf('</script>', mStart);
  const manifest = JSON.parse(doc.slice(mStart, mEnd));
  let changed = false;
  for (const entry of Object.values(manifest)) {
    const buf = Buffer.from(entry.data, 'base64');
    if (/javascript/.test(entry.mime)) {
      const txt = (entry.compressed ? zlib.gunzipSync(buf) : buf).toString('utf8');
      if (txt.includes('window.AIRPORTS =') && txt !== airportsSrc) {
        entry.data = zlib.gzipSync(Buffer.from(airportsSrc, 'utf8')).toString('base64');
        entry.compressed = true;
        changed = true;
      }
    } else if (entry.mime === 'text/html') {
      const inner = (entry.compressed ? zlib.gunzipSync(buf) : buf).toString('utf8');
      const res = swapAirports(inner);
      const mapped = patchMapDoc(res.doc);
      if (mapped.changed) console.log('applied 25-marker map cap to nested map page');
      const styled = patchMapTableau(mapped.doc);
      if (styled.changed) console.log('applied tableau-style clusters to nested map page');
      const scaled = patchMapZoomCap(styled.doc);
      if (scaled.changed) console.log('applied zoom-scaled marker cap');
      const legended = patchMapLegend(scaled.doc);
      if (legended.changed) console.log('applied airport-category colors + legend');
      const zoomed = patchMapZoomPos(legended.doc);
      if (zoomed.changed) console.log('moved map zoom control to bottom-right');
      if (res.changed || mapped.changed || styled.changed || scaled.changed || legended.changed || zoomed.changed) {
        entry.data = zlib.gzipSync(Buffer.from(zoomed.doc, 'utf8')).toString('base64');
        entry.compressed = true;
        changed = true;
      }
    }
  }
  if (!changed) return { doc, changed: false };
  const mjson = JSON.stringify(manifest).replace(/<\//g, '<\\/');
  return { doc: doc.slice(0, mStart) + mjson + doc.slice(mEnd), changed: true };
}
const swapped = swapAirports(out);
if (swapped.changed) {
  out = swapped.doc;
  console.log('swapped airports dataset into bundle manifests');
}

// Outer-document script: inline scripts inside the design template never
// execute (the bundler swaps the document via DOM insertion), but the outer
// page's scripts run on load and their timers survive the swap — same trick
// as the demo toolbar. Handles SW registration + the mobile map-expand button.
// Upgrade/emit the outer boot script: SW registration only (the old map
// expand button is superseded by the tap-a-location-box flow).
const BOOT_V2 = '<script>window.__slipOuterBoot=2;(function(){if("serviceWorker" in navigator){try{navigator.serviceWorker.register("/sw.js")}catch(e){}}})();</scr' + 'ipt>\n';
const oldBoot = /<script>window\.__slipOuterBoot=1;[^<]*<\/script>\n/;
if (oldBoot.test(out)) {
  out = out.replace(oldBoot, BOOT_V2);
  console.log('upgraded outer-boot script to v2 (SW only)');
} else if (!out.includes('__slipOuterBoot')) {
  out = out.replace('</script>\n</body>\n</html>', '</script>\n' + BOOT_V2 + '</body>\n</html>');
  console.log('applied outer-boot script v2 (SW only)');
}

fs.writeFileSync(bundlePath, out);
console.log('packed', logic.length, 'chars of logic into', path.relative(root, bundlePath), '→', out.length, 'bytes total');
