
class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.mapRef = React.createRef();
    this.CATS = [
      { id: 'prop', label: 'Turboprop', seats: '4–8' }, { id: 'light', label: 'Light jet', seats: '5–7' },
      { id: 'mid', label: 'Midsize', seats: '7–9' }, { id: 'smid', label: 'Super-mid', seats: '8–10' },
      { id: 'heavy', label: 'Heavy', seats: '10–16' }, { id: 'ulr', label: 'Ultra-long', seats: '12–18' }
    ];
    this.BUDGETS = ['Under $15k', '$15–30k', '$30–60k', '$60k+', 'Flexible'];
    this.NEEDS = ['Pet on board', 'Medical equipment', 'Extra baggage', 'Wheelchair access'];
    this.ADDONS = ['Catering', 'Ground transport', 'Wi-Fi required'];
    this.me = null;
    this.state = {
      role: (props.defaultRole === 'operator') ? 'operator' : 'client',
      view: (props.defaultRole === 'operator') ? 'operator' : 'request',
      userInitials: (props.defaultRole === 'operator') ? 'OP' : 'TR',
      tripType: 'oneway',
      legs: [{ from: null, to: null, date: '2026-09-14', time: '09:00' }],
      returnDate: '2026-09-18', returnTime: '17:00',
      pax: 4, flexDays: '0', cats: ['light'], budget: '$15–30k',
      needs: [], addons: [], notes: '',
      active: { leg: 0, side: 'from' },
      visible: [], visibleCount: 0,
      requests: [], marketplace: [],
      activeReqId: null,
      compare: [], accepted: {}, chatWith: null, chatText: '',
      chats: {},
      opSelId: null, opBids: {}, inbox: [],
      bidAircraft: '', bidPrice: '', bidMsg: '', bidEmpty: false, bidValid: '48',
      menuOpen: false, profileName: '', pwCurrent: '', pwNew: '', acctMsg: '', showEL: true,
      ctLink: '', ctMsg: '', checkoutOpen: false, apSearch: '',
      profileOpen: false, prCompany: '', prCert: '', prBase: '', prTail: '', prModel: '', prMsg: '',
      prSafety: '',
      rvFor: null, rvStars: 0, rvText: '', rvMsg: '',
      emptyLegs: [], myLegs: [],
      legFormOpen: false, legFrom: '', legTo: '', legDate: '', legTime: '09:00',
      legAircraft: '', legPrice: '', legNote: '', legMsg: '',
      depOpen: false, depAmount: 0,
      apOpen: false, mapOpen: false,
      opView: 'desk', expEdits: {}, expMsg: '',
      conOpen: false, conTopic: 'trip', conReqId: null, conMsg: '', conPhone: '', conBusy: false, conDone: '', conErr: '',
      staffOpen: false, staffTab: 'messages', opNotes: {}, opReasons: {}, opExpiry: {}, staffMsg: '',
      rsMsg: '', rsErr: '', rsBusy: false
    };
    this.opStats = null;
    this.DEPOSIT_TIERS = { prop: 150, light: 150, mid: 250, smid: 250, heavy: 500, ulr: 500 };
    this.opProfile = null;
  }
  ap(code) { return this.airports ? this.airports.find(a => a.iata === code) : null; }
  fmtDate(d) { const dt = new Date(d + 'T12:00'); return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  fmtPrice(p) { return '$' + p.toLocaleString('en-US'); }
  // 'YYYY-MM-DD' as a full date; expiry dates are compared and shown in UTC.
  fmtDay(d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
  // Where a declared safety rating stands: mirrors ratingState() in the worker.
  ratingState(pr) {
    if (!pr || !pr.safety_program) return { claimed: null };
    const today = new Date().toISOString().slice(0, 10);
    const confirmed = pr.safety_verified === pr.safety_program;
    const expires = confirmed ? pr.safety_expires || null : null;
    const expired = confirmed && (!expires || expires < today);
    return {
      claimed: pr.safety_program, hasDoc: !!pr.safety_doc_name, confirmed, expires, expired,
      daysLeft: expires && !expired ? Math.round((Date.parse(expires) - Date.parse(today)) / 86400000) : null,
      newDoc: confirmed && !!pr.safety_doc_at && !!pr.safety_verified_at && pr.safety_doc_at > pr.safety_verified_at
    };
  }

  // Cabin class for the quote-card art, from the model name first (operators
  // type free text) and the seat count as a fallback.
  acClass(name, seats) {
    const m = (name || '').toLowerCase();
    if (/king air|pc-?12|tbm|caravan|kodiak|avanti|cheyenne|conquest|meridian|m[56]00|turboprop/.test(m)) return 'prop';
    if (/challenger 3|sovereign|latitude|longitude|xls|excel|citation x|hawker|praetor|legacy [45]|g280|g200|learjet 6|falcon 50/.test(m)) return 'mid';
    if (/gulfstream|\bg[2-7]\d0|global|falcon (7|8|9|2000)|challenger (6|8)|legacy 6|lineage|bbj|acj/.test(m)) return 'heavy';
    if (/phenom|cj\d|citation m2|mustang|bravo|encore|learjet [347]|hondajet|eclipse|premier|beechjet|nextant|pc-?24|sf50|vision/.test(m)) return 'light';
    const s = parseInt(seats, 10) || 0;
    return s >= 12 ? 'heavy' : s >= 8 ? 'mid' : 'light';
  }

  // Side-profile silhouette on navy, shown until the operator uploads a photo.
  // Returned as a data URI so the template can bind it to an <img>.
  acArt(kind) {
    this._art = this._art || {};
    if (this._art[kind]) return this._art[kind];
    const NAVY = '#16233B', BODY = '#F3EEE3', SHADE = '#DDD5C4';
    const spec = { prop: { L: 236, D: 34, win: 5, prop: true }, light: { L: 256, D: 30, win: 5 }, mid: { L: 300, D: 33, win: 7 }, heavy: { L: 348, D: 37, win: 9 } }[kind];
    const { L, D, win } = spec;
    const r1 = v => Math.round(v * 10) / 10;
    const W = 440, H = 280, cy = 146, x0 = (W - L) / 2, yt = cy - D / 2, yb = cy + D / 2, fin = 1.55 * D;
    const X = f => r1(x0 + f * L), Y = f => r1(cy + f * D);
    const fuselage = 'M' + X(0) + ',' + Y(-0.3) + ' L' + X(0.18) + ',' + r1(yt) + ' L' + X(0.78) + ',' + r1(yt)
      + ' C' + X(0.88) + ',' + r1(yt) + ' ' + X(0.95) + ',' + Y(-0.12) + ' ' + X(1) + ',' + Y(0.14)
      + ' C' + X(0.96) + ',' + Y(0.42) + ' ' + X(0.9) + ',' + r1(yb) + ' ' + X(0.84) + ',' + r1(yb)
      + ' L' + X(0.42) + ',' + r1(yb) + ' C' + X(0.25) + ',' + r1(yb) + ' ' + X(0.1) + ',' + Y(0.05) + ' ' + X(0) + ',' + Y(-0.16) + ' Z';
    const sy = r1(yt - fin - 1);
    let parts = '<polygon points="' + [X(0.25) + ',' + r1(yt + 3), X(0.06) + ',' + r1(yt + 3), X(-0.04) + ',' + r1(yt - fin), X(0.075) + ',' + r1(yt - fin)].join(' ') + '" fill="' + BODY + '"/>'
      + '<path d="M' + X(-0.09) + ',' + sy + ' Q' + X(0.01) + ',' + r1(sy - 6) + ' ' + X(0.12) + ',' + sy + ' Q' + X(0.01) + ',' + r1(sy + 5) + ' ' + X(-0.09) + ',' + sy + ' Z" fill="' + BODY + '"/>'
      + '<path d="' + fuselage + '" fill="' + BODY + '"/>'
      + '<polygon points="' + [X(0.64) + ',' + r1(yb - 5), X(0.5) + ',' + r1(yb - 3), X(0.355) + ',' + r1(yb + 21), X(0.4) + ',' + r1(yb + 21)].join(' ') + '" fill="' + SHADE + '"/>'
      + '<polygon points="' + [X(0.355) + ',' + r1(yb + 21), X(0.325) + ',' + r1(yb + 1), X(0.34) + ',' + r1(yb + 1), X(0.385) + ',' + r1(yb + 21)].join(' ') + '" fill="' + SHADE + '"/>';
    if (spec.prop) {
      const ny = r1(yb - 1), a = X(0.5), b = X(0.73);
      parts += '<rect x="' + a + '" y="' + r1(ny - 8) + '" width="' + r1(b - a) + '" height="16" rx="8" fill="' + SHADE + '" stroke="' + NAVY + '" stroke-width="2"/>'
        + '<path d="M' + b + ',' + r1(ny - 5) + ' L' + r1(b + 9) + ',' + ny + ' L' + b + ',' + r1(ny + 5) + ' Z" fill="' + SHADE + '"/>'
        + '<ellipse cx="' + r1(b + 4) + '" cy="' + ny + '" rx="2.2" ry="' + r1(D * 0.95) + '" fill="' + BODY + '" opacity=".85"/>';
    } else {
      const eh = r1(D * 0.62);
      parts += '<rect x="' + X(0.2) + '" y="' + r1(yt - eh * 0.45) + '" width="' + r1(0.18 * L) + '" height="' + eh + '" rx="' + r1(eh / 2) + '" fill="' + SHADE + '" stroke="' + NAVY + '" stroke-width="2"/>';
    }
    const wa = x0 + 0.4 * L, wb = x0 + 0.74 * L;
    for (let i = 0; i < win; i++) {
      const wx = wa + ((wb - wa) * i) / (win - 1);
      parts += spec.prop
        ? '<circle cx="' + r1(wx) + '" cy="' + Y(-0.16) + '" r="4.6" fill="' + NAVY + '"/>'
        : '<rect x="' + r1(wx - 4.5) + '" y="' + Y(-0.36) + '" width="9" height="12" rx="4.2" fill="' + NAVY + '"/>';
    }
    parts += '<polygon points="' + [X(0.8) + ',' + r1(yt + 4), X(0.865) + ',' + Y(-0.2), X(0.9) + ',' + Y(0), X(0.81) + ',' + Y(-0.04)].join(' ') + '" fill="' + NAVY + '"/>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice">'
      + '<rect width="' + W + '" height="' + H + '" fill="' + NAVY + '"/>'
      + '<line x1="56" y1="212" x2="384" y2="212" stroke="#C6A667" stroke-width="1.5" opacity=".6"/>' + parts + '</svg>';
    return (this._art[kind] = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg));
  }
  routeStr(r) { const codes = [r.legs[0].from, ...r.legs.map(l => l.to)]; if (r.type === 'round') return r.legs[0].from + ' ⇄ ' + r.legs[0].to; return codes.join(' → '); }

  api(path, opts) {
    return fetch(path, opts && opts.body ? {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body)
    } : undefined).then(r => r.json().then(d => {
      if (!r.ok) { const e = new Error(d.error || 'Request failed'); e.code = d.code; throw e; }
      return d;
    }));
  }

  // Aircraft this operator may offer: matched to the FAA registry and listed on
  // the verified certificate. Empty until the operator passes the FAA check.
  quotable() {
    const p = this.opProfile;
    if (!p || !p.clearance || !p.clearance.ok) return [];
    return p.fleet.filter(a => p.clearance.cleared.includes(a.tail));
  }
  // The two checks behind the quoting gate, with what is still missing.
  gateSteps() {
    const p = this.opProfile;
    const c = (p && p.clearance) || { ok: false, certOk: false, cleared: [], autoOk: false, review: 'pending', reason: 'cert_missing' };
    const prof = (p && p.profile) || {};
    const fleet = p ? p.fleet : [];
    const certHint = c.certOk ? 'Matched to ' + prof.cert_faa_name + ' (' + prof.cert_number + ')'
      : prof.cert_number ? prof.cert_number + ' is not on the FAA Part 135 holders list. Check the designator.'
      : 'Add your certificate number to the operator profile and save.';
    const matched = fleet.filter(a => a.faa_status === 'verified');
    const acHint = c.cleared.length ? c.cleared.length + ' of ' + fleet.length + ' cleared to offer: ' + c.cleared.join(', ')
      : !fleet.length ? 'Add the aircraft you operate, then run the FAA check.'
      : fleet.every(a => !a.faa_status || a.faa_status === 'pending') ? 'Run the FAA check on your fleet.'
      : matched.length && !c.certOk ? 'Your aircraft match the registry. They are checked against your certificate once it is verified.'
      : matched.length ? 'Your aircraft match the registry but are not on certificate ' + prof.cert_number + ' in the FAA list. If your D085 changed recently, message the partner desk: we can clear an aircraft against your documents.'
      : 'No aircraft has passed yet. See the note beside each tail number, or message the partner desk.';
    const missingDocs = [!prof.cert_doc_name && 'air carrier certificate', !prof.d085_name && 'D085'].filter(Boolean);
    const reviewHint = c.review === 'approved' ? 'Approved for certificate ' + prof.cert_number + '.'
      : c.review === 'declined' ? (prof.review_reason ? 'What we need: ' + prof.review_reason : 'We could not yet confirm that this account belongs to the certificate holder.')
      : c.autoOk ? 'In review. A member of our team confirms this account belongs to the certificate holder, and you get an email when it is done.'
        + (missingDocs.length ? ' Uploading your ' + missingDocs.join(' and ') + ' speeds this up.' : '')
      : 'Starts on its own once the two checks above pass.';
    const look = (state, n) => state === 'done' ? { mark: '✓', bg: '#e8f6ee', fg: '#1e5e3c', bd: '#9fd8b6' }
      : state === 'wait' ? { mark: '…', bg: '#fbf8f0', fg: '#8a6b2e', bd: '#e6dcc3' }
      : state === 'stop' ? { mark: '!', bg: '#fdecec', fg: '#b3261e', bd: '#f3b9b4' }
      : { mark: String(n), bg: '#ffffff', fg: '#68758d', bd: '#cfd8e6' };
    return [
      { label: 'Part 135 certificate matched to the FAA list', hint: certHint, ...look(c.certOk ? 'done' : 'todo', 1) },
      { label: 'An aircraft matched to the FAA registry and your certificate', hint: acHint, ...look(c.cleared.length ? 'done' : 'todo', 2) },
      { label: 'Account confirmed by the Chartavia team', hint: reviewHint,
        ...look(c.review === 'approved' ? 'done' : c.review === 'declined' ? 'stop' : c.autoOk ? 'wait' : 'todo', 3) }
    ];
  }

  loadData() {
    return this.api('/api/bootstrap').then(d => {
      this.me = d.me;
      this.desk = d.concierge || null;
      this.review = d.review || null;
      this.partner = d.partner || null;
      const initials = (d.me.name || '??').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      if (!this.state.menuOpen) {
        this.setState({
          profileName: d.me.name,
          showEL: (d.me.prefs && 'showEmptyLegDeals' in d.me.prefs) ? !!d.me.prefs.showEmptyLegDeals : true
        });
      }
      if (d.me.role === 'client') {
        const accepted = {};
        d.requests.forEach(r => { if (r.acceptedQuoteId) accepted[r.id] = r.acceptedQuoteId; });
        const keep = this.state.activeReqId && d.requests.some(r => r.id === this.state.activeReqId);
        this.setState({
          role: 'client', userInitials: initials,
          requests: d.requests, accepted, emptyLegs: d.emptyLegs || [],
          activeReqId: keep ? this.state.activeReqId : (d.requests[0] ? d.requests[0].id : null)
        });
      } else {
        const opBids = {};
        d.marketplace.forEach(r => { if (r.myBid) opBids[r.id] = r.myBid; });
        const keep = this.state.opSelId && d.marketplace.some(r => r.id === this.state.opSelId);
        this.opProfile = d.operatorProfile || null;
        this.opStats = d.analytics || null;
        const patch = {
          role: 'operator', view: 'operator', userInitials: initials,
          marketplace: d.marketplace, opBids, inbox: d.inbox || [], myLegs: d.myEmptyLegs || [],
          opSelId: keep ? this.state.opSelId : (d.marketplace[0] ? d.marketplace[0].id : null)
        };
        const cleared = this.quotable();
        if (!cleared.some(a => 'tail:' + a.tail === this.state.bidAircraft)) {
          patch.bidAircraft = cleared.length ? 'tail:' + cleared[0].tail : '';
        }
        if (!this.state.profileOpen && this.opProfile && this.opProfile.profile) {
          const p = this.opProfile.profile;
          patch.prCompany = p.company || '';
          patch.prCert = p.cert_number || '';
          patch.prBase = p.base_iata || '';
          patch.prSafety = p.safety_program || '';
        }
        this.setState(patch);
      }
      if (this.state.chatWith) this.loadChat(this.state.chatWith);
    }).catch(() => {});
  }

  loadChat(quoteId) {
    this.api('/api/quotes/' + quoteId + '/messages').then(d => {
      this.setState({ chats: { ...this.state.chats, [quoteId]: d.messages } });
    }).catch(() => {});
  }

  componentDidMount() {
    this._onMsg = e => {
      const d = e.data || {};
      if (d.type === 'visible') {
        const key = d.count + ':' + (d.list || []).map(a => a.iata).join(',');
        if (key === this._visKey) return;
        this._visKey = key;
        this.setState({ visible: d.list || [], visibleCount: d.count });
      } else if (d.type === 'pick' && d.airport) {
        this.pickAirport(d.airport);
      } else if (d.type === 'ready') {
        this.drawRoutes();
      }
    };
    window.addEventListener('message', this._onMsg);
    this._onResize = () => this.setState({});
    window.addEventListener('resize', this._onResize);
    this.loadData();
    this._poll = setInterval(() => this.loadData(), 7000);
  }
  componentWillUnmount() {
    window.removeEventListener('message', this._onMsg);
    window.removeEventListener('resize', this._onResize);
    if (this._poll) clearInterval(this._poll);
  }
  milesBetween(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  drawRoutes() {
    const frame = this.mapRef.current;
    if (!frame || !frame.contentWindow) return;
    const segs = this.state.legs.map(leg => {
      const f = this.ap(leg.from), t = this.ap(leg.to);
      return { f: f ? [f.lat, f.lon] : null, t: t ? [t.lat, t.lon] : null };
    });
    frame.contentWindow.postMessage({ type: 'routes', segs, fit: true }, '*');
  }
  pickAirport(a) {
    if (this.state.role !== 'client' || this.state.view !== 'request') return;
    const { active } = this.state;
    const legs = this.state.legs.map((l, i) => i === active.leg ? { ...l, [active.side]: a.iata } : l);
    let next = { ...active };
    if (active.side === 'from') next = { leg: active.leg, side: 'to' };
    else if (active.leg < legs.length - 1) next = { leg: active.leg + 1, side: legs[active.leg + 1].from ? 'to' : 'from' };
    // Mobile: the map closes after each pick; the next location box reopens it.
    const patch = { legs, active: next };
    if (window.innerWidth <= 860) { patch.mapOpen = false; patch.apOpen = false; patch.apSearch = ''; }
    this.setState(patch, () => this.drawRoutes());
  }
  setTrip(t) {
    let legs = this.state.legs;
    if (t === 'multi' && legs.length < 2) {
      legs = [...legs, { from: legs[0].to, to: null, date: legs[0].date, time: '14:00' }];
    } else if (t !== 'multi' && legs.length > 1) {
      legs = [legs[0]];
    }
    this.setState({ tripType: t, legs, active: { leg: 0, side: legs[0].from ? (legs[0].to ? 'from' : 'to') : 'from' } }, () => this.drawRoutes());
  }
  postRequest() {
    const ok = this.state.legs.every(l => l.from && l.to);
    if (!ok || this._posting) return;
    const s = this.state;
    const body = {
      type: s.tripType,
      legs: s.tripType === 'round' ? [...s.legs, { from: s.legs[0].to, to: s.legs[0].from, date: s.returnDate, time: s.returnTime }] : s.legs.map(l => ({ ...l })),
      pax: s.pax, flexDays: +s.flexDays, cats: s.cats, budget: s.budget, needs: s.needs, addons: s.addons, notes: s.notes
    };
    this.maybeDeposit(body, 'builder');
  }
  depositFor(cats) {
    const amounts = (cats || []).map(c => this.DEPOSIT_TIERS[c] || 0).filter(Boolean);
    return amounts.length ? Math.max(...amounts) : 250;
  }
  maybeDeposit(body, origin) {
    const waived = (this.me && this.me.plan === 'plus') || this.state.requests.length === 0;
    if (waived) return this.sendRequest(body, origin);
    this._pendingBody = body;
    this._pendingOrigin = origin;
    this.setState({ depOpen: true, depAmount: this.depositFor(body.cats) });
  }
  confirmDeposit() {
    const body = this._pendingBody;
    if (!body) return;
    this._pendingBody = null;
    this.setState({ depOpen: false });
    this.sendRequest(body, this._pendingOrigin);
  }
  sendRequest(body, origin) {
    if (this._posting) return;
    this._posting = true;
    this.api('/api/requests', { body }).then(req => {
      const patch = { requests: [req, ...this.state.requests], activeReqId: req.id, view: 'quotes' };
      if (origin === 'builder') {
        patch.legs = [{ from: null, to: null, date: '2026-09-14', time: '09:00' }];
        patch.active = { leg: 0, side: 'from' };
        patch.notes = '';
      }
      this.setState(patch);
    }).catch(e => alert(e.message)).then(() => { this._posting = false; });
  }
  closeRequest(reqId) {
    if (!window.confirm('Close this request? Any held deposit is refunded in full.')) return;
    this.api('/api/requests/' + reqId + '/close', { body: {} })
      .then(() => this.loadData())
      .catch(e => alert(e.message));
  }
  postEmptyLeg() {
    const s = this.state;
    if (this._legging) return;
    this._legging = true;
    this.api('/api/empty-legs', { body: {
      from: s.legFrom, to: s.legTo, date: s.legDate, time: s.legTime,
      aircraft: s.legAircraft, price: +String(s.legPrice).replace(/[^0-9.]/g, ''), note: s.legNote
    } }).then(() => {
      this.setState({ legFormOpen: false, legFrom: '', legTo: '', legDate: '', legPrice: '', legNote: '', legMsg: '' });
      this.loadData();
    }).catch(e => {
      if (e.code === 'verify') { this.setState({ legFormOpen: false, profileOpen: true, prMsg: e.message }); this.loadData(); }
      else this.setState({ legMsg: e.message });
    }).then(() => { this._legging = false; });
  }
  removeEmptyLeg(id) {
    this.api('/api/empty-legs/' + id + '/remove', { body: {} })
      .then(() => this.loadData())
      .catch(e => alert(e.message));
  }
  requestEmptyLeg(leg) {
    this.maybeDeposit({
      type: 'oneway',
      legs: [{ from: leg.from, to: leg.to, date: leg.date, time: leg.time || '09:00' }],
      pax: 2, flexDays: 0, cats: [], budget: 'Flexible', needs: [], addons: [],
      notes: 'Interested in your empty leg ' + leg.from + ' → ' + leg.to + ' on ' + this.fmtDate(leg.date) + ' (listed at ' + this.fmtPrice(leg.price) + ').'
    }, 'leg');
  }
  tripAction(reqId, action, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    this.api('/api/requests/' + reqId + '/trip', { body: { action } })
      .then(() => this.loadData())
      .catch(e => alert(e.message));
  }
  submitReview(reqId) {
    const s = this.state;
    if (!s.rvStars || s.rvFor !== reqId) return;
    this.api('/api/requests/' + reqId + '/review', { body: { stars: s.rvStars, text: s.rvText } })
      .then(() => { this.setState({ rvFor: null, rvStars: 0, rvText: '', rvMsg: 'Thanks — your review is live.' }); this.loadData(); })
      .catch(e => this.setState({ rvMsg: e.message }));
  }
  acceptQuote(reqId, quoteId) {
    this.api('/api/requests/' + reqId + '/accept', { body: { quoteId } }).then(() => {
      this.setState({ accepted: { ...this.state.accepted, [reqId]: quoteId } });
      this.loadData(); // the operator's identity and certificate are revealed now, not at the next poll
    }).catch(e => alert(e.message));
  }
  submitBid(rfq) {
    const s = this.state;
    if (!s.bidPrice || this._bidding) return;
    this._bidding = true;
    const body = {
      aircraft: s.bidAircraft, price: +String(s.bidPrice).replace(/[^0-9.]/g, ''),
      message: s.bidMsg, emptyLeg: s.bidEmpty, validHours: +s.bidValid
    };
    this.api('/api/requests/' + rfq.id + '/quotes', { body }).then(d => {
      this.setState({ opBids: { ...this.state.opBids, [rfq.id]: { price: d.price } }, bidPrice: '', bidMsg: '' });
      this.loadData();
    }).catch(e => {
      if (e.code === 'upgrade') this.setState({ checkoutOpen: true, menuOpen: false });
      else if (e.code === 'verify') { this.setState({ profileOpen: true, prMsg: e.message }); this.loadData(); }
      else alert(e.message);
    }).then(() => { this._bidding = false; });
  }
  completeCheckout() {
    this.api('/api/billing/upgrade', { body: {} }).then(() => {
      this.setState({ checkoutOpen: false, acctMsg: 'Plan upgraded (demo).' });
      this.loadData();
    }).catch(e => alert(e.message));
  }
  downgradePlan() {
    this.api('/api/billing/downgrade', { body: {} }).then(() => {
      this.setState({ acctMsg: 'Back on the Free plan.' });
      this.loadData();
    }).catch(e => alert(e.message));
  }
  chipStyle(sel) {
    return sel ? { bd: '#2E6BE6', bg: '#2E6BE6', fg: '#ffffff' } : { bd: '#dde5f0', bg: '#ffffff', fg: '#4a5a76' };
  }
  toggleIn(key, val) {
    const arr = this.state[key];
    this.setState({ [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] });
  }
  saveProfile() {
    const name = this.state.profileName.trim();
    if (!name) return;
    this.api('/api/me/profile', { body: { name } }).then(d => {
      if (this.me) this.me.name = d.name;
      const initials = d.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      this.setState({ userInitials: initials, acctMsg: 'Name updated.' });
    }).catch(e => this.setState({ acctMsg: e.message }));
  }
  changePassword() {
    const s = this.state;
    if (!s.pwCurrent || !s.pwNew) return;
    this.api('/api/me/password', { body: { current: s.pwCurrent, next: s.pwNew } }).then(() => {
      this.setState({ pwCurrent: '', pwNew: '', acctMsg: 'Password changed.' });
    }).catch(e => this.setState({ acctMsg: e.message }));
  }
  toggleEL() {
    const next = !this.state.showEL;
    this.setState({ showEL: next });
    this.api('/api/me/prefs', { body: { showEmptyLegDeals: next } }).catch(() => {});
  }
  uploadContract(file) {
    const quoteId = this.state.chatWith;
    if (!quoteId || this._uploading) return;
    this._uploading = true;
    const fd = new FormData();
    fd.append('file', file);
    fetch('/api/quotes/' + quoteId + '/contract', { method: 'POST', body: fd })
      .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; }))
      .then(d => { this.setState({ ctMsg: 'Attached: ' + d.contract.name }); this.loadData(); })
      .catch(e => this.setState({ ctMsg: e.message }))
      .then(() => { this._uploading = false; });
  }
  attachContractLink() {
    const quoteId = this.state.chatWith;
    const url = this.state.ctLink.trim();
    if (!quoteId || !url) return;
    this.api('/api/quotes/' + quoteId + '/contract-link', { body: { url } })
      .then(d => { this.setState({ ctMsg: 'Attached: ' + d.contract.name, ctLink: '' }); this.loadData(); })
      .catch(e => this.setState({ ctMsg: e.message }));
  }
  saveOpProfile() {
    const s = this.state;
    this.api('/api/operator/profile', { body: { company: s.prCompany, certNumber: s.prCert, baseIata: s.prBase, safety: s.prSafety || null } })
      .then(d => {
        this.setState({ prMsg: d.faaName
          ? 'Saved — FAA Part 135 certificate verified: ' + d.faaName
          : (s.prCert ? 'Saved — certificate not found on the FAA Part 135 holders list. Double-check the designator.' : 'Saved.') });
        this.loadData();
      })
      .catch(e => this.setState({ prMsg: e.message }));
  }
  pickSafety(label) {
    const next = this.state.prSafety === label ? '' : label;
    this.setState({ prSafety: next }, () => this.saveOpProfile());
  }
  uploadCertDoc(file) {
    if (this._certing) return;
    this._certing = true;
    const fd = new FormData();
    fd.append('file', file);
    fetch('/api/operator/certificate', { method: 'POST', body: fd })
      .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; }))
      .then(d => { this.setState({ prMsg: 'Certificate uploaded: ' + d.name }); this.loadData(); })
      .catch(e => this.setState({ prMsg: e.message }))
      .then(() => { this._certing = false; });
  }
  uploadSafetyDoc(file) {
    if (this._safetying) return;
    this._safetying = true;
    const fd = new FormData();
    fd.append('file', file);
    fetch('/api/operator/safety-doc', { method: 'POST', body: fd })
      .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; }))
      .then(d => { this.setState({ prMsg: 'Audit certificate uploaded: ' + d.name + '. We will confirm your rating against it.' }); this.loadData(); })
      .catch(e => this.setState({ prMsg: e.message }))
      .then(() => { this._safetying = false; });
  }
  uploadAircraftPhoto(id, file) {
    const fd = new FormData();
    fd.append('file', file);
    fetch('/api/operator/fleet/' + id + '/photo', { method: 'POST', body: fd })
      .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; }))
      .then(() => { this.setState({ prMsg: 'Photo uploaded.' }); this.loadData(); })
      .catch(e => this.setState({ prMsg: e.message }));
  }
  addAircraft() {
    const s = this.state;
    if (!s.prTail || !s.prModel) return;
    this.api('/api/operator/fleet', { body: { tail: s.prTail, model: s.prModel } })
      .then(() => { this.setState({ prTail: '', prModel: '', prMsg: 'Aircraft added — run the FAA check to verify it.' }); this.loadData(); })
      .catch(e => this.setState({ prMsg: e.message }));
  }
  removeAircraft(id) {
    this.api('/api/operator/fleet/' + id + '/delete', { body: {} })
      .then(() => this.loadData())
      .catch(e => this.setState({ prMsg: e.message }));
  }
  runFaaCheck() {
    if (this._checking) return;
    this._checking = true;
    this.setState({ prMsg: 'Checking tail numbers against the FAA registry…' });
    this.api('/api/operator/verify', { body: {} })
      .then(d => {
        const ok = d.results.filter(r => r.status === 'verified').length;
        this.setState({ prMsg: 'FAA check complete: ' + ok + ' of ' + d.results.length + ' aircraft matched.' });
        this.loadData();
      })
      .catch(e => this.setState({ prMsg: e.message }))
      .then(() => { this._checking = false; });
  }
  uploadD085(file) {
    if (this._d085ing) return;
    this._d085ing = true;
    const fd = new FormData();
    fd.append('file', file);
    fetch('/api/operator/d085', { method: 'POST', body: fd })
      .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; }))
      .then(d => { this.setState({ prMsg: 'D085 uploaded: ' + d.name }); this.loadData(); })
      .catch(e => this.setState({ prMsg: e.message }))
      .then(() => { this._d085ing = false; });
  }
  openConcierge(topic, reqId) {
    this.setState({ conOpen: true, conTopic: topic, conReqId: reqId || null, conMsg: '', conErr: '', conDone: '', menuOpen: false });
  }
  sendConcierge() {
    const s = this.state;
    if (s.conBusy) return;
    if (s.conMsg.trim().length < 10) { this.setState({ conErr: 'Add a few words about what you need.' }); return; }
    this.setState({ conBusy: true, conErr: '' });
    this.api('/api/concierge', { body: { topic: s.conTopic, requestId: s.conReqId, phone: s.conPhone, message: s.conMsg } })
      .then(d => this.setState({ conBusy: false, conDone: d.ref || 'sent' }))
      .catch(e => this.setState({ conBusy: false, conErr: e.message || 'Could not send. Try again.' }));
  }
  resubmitReview() {
    const s = this.state;
    if (s.rsBusy) return;
    if (s.rsMsg.trim().length < 10) { this.setState({ rsErr: 'Tell us in a sentence what has changed since the review.' }); return; }
    this.setState({ rsBusy: true, rsErr: '' });
    this.api('/api/operator/review/resubmit', { body: { message: s.rsMsg } })
      .then(() => {
        this.setState({ rsBusy: false, rsMsg: '', prMsg: 'Resubmitted. You will get an email when the review is done.' });
        this.loadData();
      })
      .catch(e => this.setState({ rsBusy: false, rsErr: e.message || 'Could not resubmit. Try again.' }));
  }
  // Staff decisions on an operator. An edited note rides along with any action.
  staffOp(orgId, action, extra) {
    if (this._staffing) return;
    this._staffing = true;
    const note = this.state.opNotes[orgId];
    this.api('/api/staff/operators/' + orgId, { body: { action, ...(extra || {}), ...(note != null ? { note } : {}) } })
      .then(d => {
        this.review = d.review;
        const opNotes = { ...this.state.opNotes }, opReasons = { ...this.state.opReasons }, opExpiry = { ...this.state.opExpiry };
        delete opNotes[orgId];
        if (action === 'decline') delete opReasons[orgId];
        if (action === 'confirm_rating' || action === 'unconfirm_rating') delete opExpiry[orgId];
        this.setState({ opNotes, opReasons, opExpiry, staffMsg: '' });
      })
      .catch(e => this.setState({ staffMsg: e.message }))
      .then(() => { this._staffing = false; });
  }
  staffSet(id, status) {
    this.api('/api/staff/concierge/' + id, { body: { status } })
      .then(d => { this.desk = d.desk; this.setState({ staffTick: Date.now() }); })
      .catch(() => {});
  }

  saveExpenses(quoteId) {
    const raw = this.state.expEdits[quoteId];
    const amount = Math.round(+String(raw ?? '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(amount)) return;
    this.api('/api/operator/trips/' + quoteId + '/expenses', { body: { amount } })
      .then(() => {
        const edits = { ...this.state.expEdits };
        delete edits[quoteId];
        this.setState({ expEdits: edits, expMsg: 'Expenses saved.' });
        this.loadData();
      })
      .catch(e => this.setState({ expMsg: e.message }));
  }
  createInvite() {
    this.api('/api/operator/invites', { body: {} })
      .then(d => { this.setState({ prMsg: 'Invite code created: ' + d.code + ' — share it with your teammate; they enter it when registering as an operator.' }); this.loadData(); })
      .catch(e => this.setState({ prMsg: e.message }));
  }
  revokeInvite(code) {
    this.api('/api/operator/invites/' + code + '/revoke', { body: {} })
      .then(() => this.loadData())
      .catch(e => this.setState({ prMsg: e.message }));
  }
  removeMember(id) {
    this.api('/api/operator/members/' + id + '/remove', { body: {} })
      .then(() => { this.setState({ prMsg: 'Member removed.' }); this.loadData(); })
      .catch(e => this.setState({ prMsg: e.message }));
  }
  logout() {
    this.api('/api/logout', { body: {} }).then(() => { window.location.href = '/login'; })
      .catch(() => { window.location.href = '/login'; });
  }
  renderVals() {
    const s = this.state;
    const showEL = s.showEL;
    if (!this.airports && window.AIRPORTS) this.airports = window.AIRPORTS.map(r => ({ iata: r[0], name: r[1], city: r[2], cc: r[3], lat: r[4], lon: r[5], tier: r[6] }));
    const apName = c => { const a = this.ap(c); return a ? a.name : ''; };
    const seg = on => on ? { bg: '#ffffff', fg: '#16233b', sh: '0 1px 3px rgba(22,35,59,.14)' } : { bg: 'transparent', fg: '#68758d', sh: 'none' };
    const segDark = on => on ? seg(true) : { bg: 'transparent', fg: '#b7c4dc', sh: 'none' }; // role toggle sits on the navy header

    const legsView = s.legs.map((l, i) => {
      const isActive = side => s.active.leg === i && s.active.side === side;
      return {
        num: i + 1, showHeader: s.tripType === 'multi', canRemove: s.tripType === 'multi' && s.legs.length > 2,
        onRemove: () => { const legs = s.legs.filter((_, j) => j !== i); this.setState({ legs, active: { leg: 0, side: 'from' } }, () => this.drawRoutes()); },
        fromCode: l.from || '—', fromName: l.from ? apName(l.from) : 'Choose on map',
        toCode: l.to || '—', toName: l.to ? apName(l.to) : 'Choose on map',
        fromCodeColor: l.from ? '#16233b' : '#a9b4c8', toCodeColor: l.to ? '#16233b' : '#a9b4c8',
        fromBorder: isActive('from') ? 'solid #2E6BE6' : (l.from ? 'solid #dde5f0' : 'dashed #b9c8e0'),
        toBorder: isActive('to') ? 'solid #2E6BE6' : (l.to ? 'solid #dde5f0' : 'dashed #b9c8e0'),
        onFromClick: () => this.setState({ active: { leg: i, side: 'from' }, ...(window.innerWidth <= 860 ? { mapOpen: true } : {}) }),
        onToClick: () => this.setState({ active: { leg: i, side: 'to' }, ...(window.innerWidth <= 860 ? { mapOpen: true } : {}) }),
        onSwap: () => { const legs = s.legs.map((x, j) => j === i ? { ...x, from: x.to, to: x.from } : x); this.setState({ legs }, () => this.drawRoutes()); },
        date: l.date, time: l.time,
        onDate: e => { const v = e.target.value; this.setState({ legs: s.legs.map((x, j) => j === i ? { ...x, date: v } : x) }); },
        onTime: e => { const v = e.target.value; this.setState({ legs: s.legs.map((x, j) => j === i ? { ...x, time: v } : x) }); }
      };
    });

    const actLeg = s.legs[s.active.leg];
    const legLabel = s.tripType === 'multi' ? 'flight ' + (s.active.leg + 1) : 'your trip';
    const mapPrompt = actLeg && !actLeg[s.active.side]
      ? 'Click an airport on the map — setting ' + s.active.side.toUpperCase() + ' for ' + legLabel
      : 'Click any airport to change ' + s.active.side.toUpperCase() + ' for ' + legLabel;

    const readyToPost = s.legs.every(l => l.from && l.to);

    // ---- airport search (all airports) vs map-visible list ----
    const isMobile = window.innerWidth <= 860;
    const q = s.apSearch.trim().toUpperCase();
    let apMatches = null, apTotal = 0, apAnchor = null, apNear = null;
    if (q && this.airports) {
      const scored = [];
      for (let i = 0; i < this.airports.length; i++) {
        const a = this.airports[i];
        const name = a.name.toUpperCase(), city = (a.city || '').toUpperCase();
        let sc = -1;
        if (a.iata === q) sc = 0;
        else if (a.iata.indexOf(q) === 0) sc = 1;
        else if (name.indexOf(q) === 0 || city.indexOf(q) === 0) sc = 2;
        else if (name.indexOf(q) >= 0 || city.indexOf(q) >= 0) sc = 3;
        if (sc >= 0) scored.push([sc, a]);
      }
      scored.sort((x, y) => x[0] - y[0] || x[1].tier - y[1].tier || (x[1].name < y[1].name ? -1 : 1));
      apTotal = scored.length;
      apMatches = scored.slice(0, 30).map(x => x[1]);
      // Mobile: the query names a LOCATION — list every airport within 100
      // miles of the best match, nearest first, with distances.
      if (isMobile && scored.length) {
        apAnchor = scored[0][1];
        const withD = [];
        for (let i = 0; i < this.airports.length; i++) {
          const a = this.airports[i];
          const d = this.milesBetween(apAnchor.lat, apAnchor.lon, a.lat, a.lon);
          if (d <= 100) withD.push([d, a]);
        }
        withD.sort((x, y) => x[0] - y[0]);
        apTotal = withD.length;
        apNear = withD.slice(0, 30);
      }
    }

    // ---- client quotes ----
    const activeReq = s.requests.find(r => r.id === s.activeReqId) || s.requests[0];
    const acceptedId = activeReq ? s.accepted[activeReq.id] : null;
    const quotes = activeReq ? activeReq.quotes.filter(q => showEL || !q.emptyLeg) : [];
    const acceptedQuote = quotes.find(q => q.id === acceptedId);
    const chatQuote = quotes.find(q => q.id === s.chatWith);
    const catLabel = id => (this.CATS.find(c => c.id === id) || {}).label || id;

    const reqChips = r => {
      const ch = [r.pax + ' passengers'];
      if (r.flexDays) ch.push('± ' + r.flexDays + ' day' + (r.flexDays > 1 ? 's' : ''));
      ch.push(...r.cats.map(catLabel));
      ch.push('Budget ' + r.budget);
      ch.push(...r.needs, ...r.addons);
      return ch;
    };

    // ---- operator ----
    const rfq = s.marketplace.find(r => r.id === s.opSelId) || s.marketplace[0];
    const rfqBid = rfq ? s.opBids[rfq.id] : null;
    const inboxChat = s.role === 'operator' ? s.inbox.find(c => c.quoteId === s.chatWith) : null;
    const gateOk = !!(this.opProfile && this.opProfile.clearance && this.opProfile.clearance.ok);
    const gateWhy = this.opProfile && this.opProfile.clearance ? this.opProfile.clearance.reason : null;
    const opIsAdmin = !!(this.opProfile && this.opProfile.team && this.opProfile.team.myOrgRole === 'admin');

    // The signed-in account's role is authoritative: the header toggle only
    // "switches" to the role you actually are (the other side is a no-op).
    const realRole = this.me ? this.me.role : s.role;

    return {
      // header
      isClient: s.role === 'client', isOperator: s.role === 'operator',
      avatarInitials: s.userInitials,

      // account menu
      menuOpen: s.menuOpen,
      toggleMenu: () => this.setState({ menuOpen: !s.menuOpen, acctMsg: '' }),
      accountName: this.me ? this.me.name : '',
      accountEmail: this.me ? this.me.email : '',
      accountRole: realRole === 'operator' ? 'Operator' : 'Traveler',
      profileName: s.profileName,
      onProfileName: e => this.setState({ profileName: e.target.value }),
      saveProfile: () => this.saveProfile(),
      elLabel: s.showEL ? 'On' : 'Off',
      elBg: s.showEL ? '#2E6BE6' : '#eef2f8', elFg: s.showEL ? '#ffffff' : '#4a5a76',
      toggleEL: () => this.toggleEL(),
      pwCurrent: s.pwCurrent, onPwCurrent: e => this.setState({ pwCurrent: e.target.value }),
      pwNew: s.pwNew, onPwNew: e => this.setState({ pwNew: e.target.value }),
      changePassword: () => this.changePassword(),
      acctMsg: s.acctMsg || false,
      doLogout: () => this.logout(),

      // operator profile / FAA verification
      profBtnShow: realRole === 'operator',
      openProfile: () => this.setState({ profileOpen: true, menuOpen: false, prMsg: '' }),
      closeProfile: () => this.setState({ profileOpen: false }),
      profileOpen: s.profileOpen,
      profBadge: this.opProfile ? this.opProfile.badge : 'Unverified',
      profBadgeBg: this.opProfile && this.opProfile.badge.startsWith('FAA 135 verified') ? '#e8f6ee'
        : this.opProfile && this.opProfile.badge !== 'Unverified' ? '#eef3fd' : '#eef2f8',
      profBadgeFg: this.opProfile && this.opProfile.badge.startsWith('FAA 135 verified') ? '#1e5e3c'
        : this.opProfile && this.opProfile.badge !== 'Unverified' ? '#2E6BE6' : '#68758d',
      prCompany: s.prCompany, onPrCompany: e => this.setState({ prCompany: e.target.value }),
      prCert: s.prCert, onPrCert: e => this.setState({ prCert: e.target.value }),
      prBase: s.prBase, onPrBase: e => this.setState({ prBase: e.target.value }),
      saveOpProfile: () => this.saveOpProfile(),
      prFleet: (this.opProfile ? this.opProfile.fleet : []).map(a => {
        const staffCleared = a.staff_ok === 1 && ['verified', 'found', 'mismatch'].includes(a.faa_status);
        const st = staffCleared ? { label: 'CLEARED BY CHARTAVIA', bg: '#e8f6ee', fg: '#1e5e3c' }
          : a.faa_status === 'verified' && a.on_cert === 0 ? { label: 'NOT ON CERTIFICATE', bg: '#fdecec', fg: '#b3261e' }
          : a.faa_status === 'verified' ? { label: 'FAA MATCH', bg: '#e8f6ee', fg: '#1e5e3c' }
          : a.faa_status === 'found' ? { label: 'ON REGISTRY', bg: '#eef3fd', fg: '#2E6BE6' }
          : a.faa_status === 'mismatch' ? { label: 'MODEL MISMATCH', bg: '#fdecec', fg: '#b3261e' }
          : a.faa_status === 'not_found' ? { label: 'NOT FOUND', bg: '#fdecec', fg: '#b3261e' }
          : { label: 'UNCHECKED', bg: '#eef2f8', fg: '#68758d' };
        const isAdm = !!(this.opProfile && this.opProfile.team && this.opProfile.team.myOrgRole === 'admin');
        return {
          tail: a.tail, model: a.model_claim,
          status: st.label, statusBg: st.bg, statusFg: st.fg,
          faaInfo: a.faa_model
            ? 'FAA registry: ' + (a.faa_mfr || '') + ' ' + a.faa_model
              + (a.on_cert === 1 ? ' · on your 135 certificate' : a.on_cert === 0 ? ' · NOT on your 135 certificate' : '')
              + (staffCleared ? ' · cleared by our team against your documents'
                : (a.on_cert === 0 || a.faa_status === 'found') ? ' · the partner desk can clear it against your D085' : '')
            : false,
          showRemove: isAdm,
          onRemove: () => this.removeAircraft(a.id),
          hasPhoto: !!a.photo_at,
          photoUrl: a.photo_at ? '/api/fleet/' + a.id + '/photo?v=' + encodeURIComponent(a.photo_at) : '',
          canPhoto: isAdm,
          photoLabel: a.photo_at ? 'Replace photo' : 'Add photo',
          onPhotoFile: e => { const f = e.target.files && e.target.files[0]; if (f) { this.uploadAircraftPhoto(a.id, f); e.target.value = ''; } }
        };
      }),
      prHasFleet: !!(this.opProfile && this.opProfile.fleet.length),
      prTail: s.prTail, onPrTail: e => this.setState({ prTail: e.target.value }),
      prModel: s.prModel, onPrModel: e => this.setState({ prModel: e.target.value }),
      addAircraft: () => this.addAircraft(),
      runFaaCheck: () => this.runFaaCheck(),
      onD085File: e => { const f = e.target.files && e.target.files[0]; if (f) { this.uploadD085(f); e.target.value = ''; } },
      d085Name: (this.opProfile && this.opProfile.profile && this.opProfile.profile.d085_name) || '',
      hasD085: !!(this.opProfile && this.opProfile.profile && this.opProfile.profile.d085_name),
      prMsg: s.prMsg || false,

      // safety program + air carrier certificate doc
      safetyOpts: ['ARGUS Gold', 'ARGUS Gold+', 'ARGUS Platinum', 'Wyvern Registered', 'Wyvern Wingman', 'IS-BAO Stage 1', 'IS-BAO Stage 2', 'IS-BAO Stage 3'].map(label => ({
        label, ...this.chipStyle(s.prSafety === label), onPick: () => this.pickSafety(label)
      })),
      ...(() => {
        const pr = (this.opProfile && this.opProfile.profile) || {};
        const r = this.ratingState(pr);
        const soon = r.confirmed && !r.expired && r.daysLeft <= 30;
        const until = r.expires ? this.fmtDay(r.expires) : '';
        return {
          safetyHint: !r.claimed ? 'Pick your current rating, then upload the audit certificate. It appears on your quotes once our team has confirmed it.'
            : r.confirmed && r.expired ? (r.newDoc
              ? 'Your renewed audit certificate is with our team. The rating returns to your quotes once it is confirmed.'
              : (until ? 'Expired on ' + until + ', so the rating' : 'The rating') + ' is hidden from travelers. Upload the renewed audit certificate and our team will confirm it.')
            : soon ? 'Valid until ' + until + ' (' + r.daysLeft + (r.daysLeft === 1 ? ' day' : ' days') + ' left). '
              + (r.newDoc ? 'Your renewed certificate is with our team.' : 'Upload the renewed audit certificate now so the rating never drops off your quotes.')
            : r.confirmed ? 'Confirmed against your audit certificate, valid until ' + until + '. Shown on your quotes and empty legs. Tap again to clear.'
            : r.hasDoc ? 'Awaiting confirmation by our team. Not shown to travelers yet.'
            : 'Not shown to travelers yet. Upload your audit certificate so our team can confirm it.',
          safetyHintFg: r.confirmed && r.expired ? '#b3261e' : r.confirmed && !soon ? '#1e5e3c' : r.claimed ? '#8a6b2e' : '#8593ab',
          hasSafetyDoc: !!pr.safety_doc_name, safetyDocName: pr.safety_doc_name || '',
          onSafetyDocFile: e => { const f = e.target.files && e.target.files[0]; if (f) { this.uploadSafetyDoc(f); e.target.value = ''; } },
        };
      })(),
      onCertDocFile: e => { const f = e.target.files && e.target.files[0]; if (f) { this.uploadCertDoc(f); e.target.value = ''; } },
      certDocName: (this.opProfile && this.opProfile.profile && this.opProfile.profile.cert_doc_name) || '',
      hasCertDoc: !!(this.opProfile && this.opProfile.profile && this.opProfile.profile.cert_doc_name),

      // team (org) management
      prIsAdmin: !!(this.opProfile && this.opProfile.team && this.opProfile.team.myOrgRole === 'admin'),
      prIsMember: !!(this.opProfile && this.opProfile.team && this.opProfile.team.myOrgRole === 'member'),
      teamMembers: (this.opProfile && this.opProfile.team ? this.opProfile.team.members : []).map(u => ({
        name: u.name, email: u.email,
        roleLabel: u.org_role === 'admin' ? 'ADMIN' : 'MEMBER',
        roleBg: u.org_role === 'admin' ? '#eef3fd' : '#eef2f8',
        roleFg: u.org_role === 'admin' ? '#2E6BE6' : '#68758d',
        canRemove: !!(this.opProfile && this.opProfile.team && this.opProfile.team.myOrgRole === 'admin' && u.org_role !== 'admin'),
        onRemove: () => this.removeMember(u.id)
      })),
      teamInvites: (this.opProfile && this.opProfile.team && this.opProfile.team.myOrgRole === 'admin'
        ? this.opProfile.team.invites.filter(i => !i.used_by) : []).map(i => ({
          code: i.code, onRevoke: () => this.revokeInvite(i.code)
        })),
      hasInvites: !!(this.opProfile && this.opProfile.team && this.opProfile.team.myOrgRole === 'admin'
        && this.opProfile.team.invites.some(i => !i.used_by)),
      createInvite: () => this.createInvite(),

      // plan + demo checkout
      planLabel: !this.me ? '—'
        : this.me.plan === 'pro' ? 'Operator Pro'
        : this.me.plan === 'plus' ? 'Chartavia Plus'
        : 'Free plan',
      planDetail: !this.me ? ''
        : (realRole === 'operator'
          ? (this.me.plan === 'pro'
            ? 'Instant access · priority placement' + (this.me.stats
              ? ' · ' + this.me.stats.sent + ' quotes, ' + this.me.stats.won + ' won'
                + (this.me.stats.sent ? ' (' + Math.round(this.me.stats.won / this.me.stats.sent * 100) + '%)' : '')
              : '')
            : 'New requests delayed 15 min · 3 team seats · 3 empty-leg slots')
          : (this.me.plan === 'plus' ? 'Request deposits waived' : 'Refundable deposit per request ($150–500)'))
          + (this.me && this.me.orgRole === 'member' ? ' · managed by your team admin' : ''),
      planIsFree: !!this.me && this.me.plan === 'free' && this.me.orgRole !== 'member',
      planIsPaid: !!this.me && this.me.plan !== 'free' && this.me.orgRole !== 'member',
      planUpgradeLabel: realRole === 'operator' ? 'Upgrade to Pro — $299/mo (demo)' : 'Upgrade to Plus — $79/mo (demo)',
      openCheckout: () => this.setState({ checkoutOpen: true, menuOpen: false }),
      downgradePlan: () => this.downgradePlan(),
      checkoutOpen: s.checkoutOpen,
      coTag: realRole === 'operator' ? 'CHARTAVIA PRO' : 'CHARTAVIA PLUS',
      coName: realRole === 'operator' ? 'Operator Pro' : 'Traveler Plus',
      coPrice: realRole === 'operator' ? '$299' : '$79',
      coFeatures: realRole === 'operator'
        ? [{ label: 'See new requests instantly (free tier waits 15 min)' }, { label: 'Priority placement — your quotes list first' }, { label: 'Unlimited team seats (free: 3)' }, { label: '20 empty-leg slots (free: 3)' }]
        : [{ label: 'Request deposits waived on every trip' }, { label: 'Empty-leg deal alerts' }, { label: 'Priority support' }, { label: 'Cancellation assistance' }],
      coComplete: () => this.completeCheckout(),
      coCancel: () => this.setState({ checkoutOpen: false }),
      roleClient: () => { if (realRole === 'client') this.setState({ role: 'client', view: s.view === 'operator' ? 'request' : s.view, chatWith: null }); },
      roleOperator: () => { if (realRole === 'operator') this.setState({ role: 'operator', view: 'operator', chatWith: null }); },
      roleCliBg: segDark(s.role === 'client').bg, roleCliFg: segDark(s.role === 'client').fg, roleCliSh: segDark(s.role === 'client').sh,
      roleOpBg: segDark(s.role === 'operator').bg, roleOpFg: segDark(s.role === 'operator').fg, roleOpSh: segDark(s.role === 'operator').sh,
      goRequest: () => this.setState({ view: 'request', chatWith: null, staffOpen: false }),
      goQuotes: () => this.setState({ view: 'quotes', staffOpen: false }),
      goDeals: () => this.setState({ view: 'deals', chatWith: null, staffOpen: false }),
      navReqBg: !s.staffOpen && s.view === 'request' ? 'rgba(255,255,255,.13)' : 'transparent', navReqFg: !s.staffOpen && s.view === 'request' ? '#ffffff' : '#b7c4dc',
      navQuoBg: !s.staffOpen && s.view === 'quotes' ? 'rgba(255,255,255,.13)' : 'transparent', navQuoFg: !s.staffOpen && s.view === 'quotes' ? '#ffffff' : '#b7c4dc',
      navDealBg: !s.staffOpen && s.view === 'deals' ? 'rgba(255,255,255,.13)' : 'transparent', navDealFg: !s.staffOpen && s.view === 'deals' ? '#ffffff' : '#b7c4dc',
      myRequestCount: s.requests.length, openRfqCount: s.marketplace.length,
      dealCount: s.emptyLegs.length,
      showRequest: !s.staffOpen && s.role === 'client' && s.view === 'request',
      showQuotes: !s.staffOpen && s.role === 'client' && s.view === 'quotes',
      showDeals: !s.staffOpen && s.role === 'client' && s.view === 'deals',
      showOperator: !s.staffOpen && s.role === 'operator' && s.opView !== 'stats',
      showOpStats: !s.staffOpen && s.role === 'operator' && s.opView === 'stats',

      // operator nav + analytics
      goDesk: () => this.setState({ opView: 'desk', chatWith: null, staffOpen: false }),
      goStats: () => this.setState({ opView: 'stats', chatWith: null, expMsg: '', staffOpen: false }),
      navDeskBg: !s.staffOpen && s.opView !== 'stats' ? 'rgba(255,255,255,.13)' : 'transparent', navDeskFg: !s.staffOpen && s.opView !== 'stats' ? '#ffffff' : '#b7c4dc',
      navStatBg: !s.staffOpen && s.opView === 'stats' ? 'rgba(255,255,255,.13)' : 'transparent', navStatFg: !s.staffOpen && s.opView === 'stats' ? '#ffffff' : '#b7c4dc',
      ...(() => {
        const a = this.opStats;
        if (!a) return { stTiles: [], tripRows: [], hasTrips: false, noTrips: true, memberRows: [], showMembers: false, expNote: false, expMsg: false };
        const money = (v) => '$' + Math.round(v).toLocaleString('en-US');
        return {
          stTiles: [
            { label: 'QUOTES SENT', value: String(a.sent) },
            { label: 'TRIPS WON', value: String(a.won) },
            { label: 'WIN RATE', value: a.winRate + '%' },
            { label: 'REVENUE', value: money(a.revenue) },
            { label: 'EXPENSES', value: money(a.expenses) },
            { label: 'PROFIT', value: money(a.profit) },
            { label: 'MARGIN', value: a.marginPct === null ? '—' : a.marginPct + '%' },
          ],
          expNote: a.expMissing > 0
            ? a.expMissing + ' won trip' + (a.expMissing === 1 ? ' is' : 's are') + ' missing expenses — profit and margin cover only trips with costs entered.'
            : false,
          hasTrips: a.trips.length > 0,
          noTrips: a.trips.length === 0,
          tripRows: a.trips.map(t => {
            const editing = s.expEdits[t.quoteId] !== undefined;
            const expVal = editing ? s.expEdits[t.quoteId] : (t.expenses != null ? String(t.expenses) : '');
            const profit = t.expenses != null ? t.price - t.expenses : null;
            return {
              route: this.routeStr(t), rid: t.rid,
              sub: this.fmtDate(t.legs[0].date) + ' · ' + t.client + ' · quoted by ' + t.member,
              status: (t.tripStatus || 'accepted').toUpperCase(),
              statusBg: t.tripStatus === 'completed' ? '#e8f6ee' : '#eef3fd',
              statusFg: t.tripStatus === 'completed' ? '#1e5e3c' : '#2E6BE6',
              price: money(t.price),
              expVal,
              onExp: e => this.setState({ expEdits: { ...s.expEdits, [t.quoteId]: e.target.value } }),
              saveExp: () => this.saveExpenses(t.quoteId),
              profitText: profit === null ? 'Enter expenses for margin'
                : money(profit) + ' profit · ' + (t.price ? Math.round(profit / t.price * 100) : 0) + '% margin',
              profitColor: profit === null ? '#8593ab' : profit >= 0 ? '#1e5e3c' : '#b3261e',
            };
          }),
          showMembers: !!a.members && a.members.length > 0,
          memberRows: (a.members || []).map(m => ({
            name: m.name,
            sub: m.sent + ' quotes · ' + m.won + ' won (' + m.winRate + '%)',
            revenue: money(m.revenue),
            profit: money(m.profit) + ' profit',
          })),
          expMsg: s.expMsg || false,
        };
      })(),

      // empty-leg board (client)
      hasDeals: s.emptyLegs.length > 0,
      noDeals: s.emptyLegs.length === 0,
      dealCards: s.emptyLegs.map(leg => ({
        route: leg.from + ' → ' + leg.to,
        when: this.fmtDate(leg.date) + (leg.time ? ' · ' + leg.time : '') + (leg.seats ? ' · up to ' + leg.seats + ' seats' : ''),
        aircraft: leg.aircraft,
        opLine: leg.op + ' · ' + leg.safety + (leg.reviews ? ' · ' + leg.rating + ' ★ (' + leg.reviews + ')' : ''),
        note: leg.note || false,
        photo: leg.photo || false,
        price: this.fmtPrice(leg.price),
        onRequest: () => this.requestEmptyLeg(leg)
      })),

      // empty-leg posting (operator)
      myLegs: s.myLegs.map(l => ({
        route: l.from + ' → ' + l.to,
        sub: this.fmtDate(l.date) + (l.time ? ' · ' + l.time : '') + ' · ' + l.aircraft + ' · ' + this.fmtPrice(l.price),
        onRemove: () => this.removeEmptyLeg(l.id)
      })),
      hasMyLegs: s.myLegs.length > 0,
      openLegForm: () => {
        const cleared = this.quotable();
        if (!cleared.length) {
          this.setState({ profileOpen: true, menuOpen: false,
            prMsg: 'Empty legs can be posted once your certificate, an aircraft and your account review are complete.' });
          return;
        }
        this.setState({ legFormOpen: true, legMsg: '', legAircraft: 'tail:' + cleared[0].tail, menuOpen: false });
      },
      closeLegForm: () => this.setState({ legFormOpen: false }),
      legFormOpen: s.legFormOpen,
      legFrom: s.legFrom, onLegFrom: e => this.setState({ legFrom: e.target.value }),
      legTo: s.legTo, onLegTo: e => this.setState({ legTo: e.target.value }),
      legDate: s.legDate, onLegDate: e => this.setState({ legDate: e.target.value }),
      legTime: s.legTime, onLegTime: e => this.setState({ legTime: e.target.value }),
      legAircraft: s.legAircraft, onLegAircraft: e => this.setState({ legAircraft: e.target.value }),
      legPrice: s.legPrice, onLegPrice: e => this.setState({ legPrice: e.target.value }),
      legNote: s.legNote, onLegNote: e => this.setState({ legNote: e.target.value }),
      postEmptyLeg: () => this.postEmptyLeg(),
      legMsg: s.legMsg || false,

      // request builder
      mapRef: this.mapRef,
      mapSrc: '/map.html',
      tripTypes: [['oneway', 'One way'], ['round', 'Round trip'], ['multi', 'Multi-city']].map(([id, label]) => ({
        label, onPick: () => this.setTrip(id), ...seg(s.tripType === id)
      })),
      legsView, isRound: s.tripType === 'round', isMulti: s.tripType === 'multi',
      returnDate: s.returnDate, returnTime: s.returnTime,
      onReturnDate: e => this.setState({ returnDate: e.target.value }),
      onReturnTime: e => this.setState({ returnTime: e.target.value }),
      addLeg: () => {
        const last = s.legs[s.legs.length - 1];
        const legs = [...s.legs, { from: last.to, to: null, date: last.date, time: '14:00' }];
        this.setState({ legs, active: { leg: legs.length - 1, side: legs[legs.length - 1].from ? 'to' : 'from' } });
      },
      pax: s.pax,
      paxMinus: () => this.setState({ pax: Math.max(1, s.pax - 1) }),
      paxPlus: () => this.setState({ pax: Math.min(18, s.pax + 1) }),
      flexDays: s.flexDays, onFlex: e => this.setState({ flexDays: e.target.value }),
      categories: this.CATS.map(c => ({ ...c, ...this.chipStyle(s.cats.includes(c.id)), onToggle: () => this.toggleIn('cats', c.id) })),
      budgets: this.BUDGETS.map(b => ({ label: b, ...this.chipStyle(s.budget === b), onPick: () => this.setState({ budget: b }) })),
      needs: this.NEEDS.map(n => ({ label: n, ...this.chipStyle(s.needs.includes(n)), onToggle: () => this.toggleIn('needs', n) })),
      addons: this.ADDONS.map(a => ({ label: a, ...this.chipStyle(s.addons.includes(a)), onToggle: () => this.toggleIn('addons', a) })),
      notes: s.notes, onNotes: e => this.setState({ notes: e.target.value }),
      postRequest: () => this.postRequest(),
      postBg: readyToPost ? '#2E6BE6' : '#b9c8e0',
      postLabel: readyToPost ? 'Send request to operators' : 'Choose airports to continue',
      mapPrompt,
      visibleCount: s.visibleCount,
      apSearch: s.apSearch,
      onApSearch: e => this.setState({ apSearch: e.target.value }),
      apSearchActive: !!q,
      clearApSearch: () => this.setState({ apSearch: '' }),
      // mobile: map hidden until a location box is tapped, fullscreen while picking
      mapHostClass: !isMobile ? '' : (s.mapOpen ? 'slip-map-full' : 'slip-map-hidden'),
      mapCloseShow: isMobile && s.mapOpen,
      closeMap: () => this.setState({ mapOpen: false, apOpen: false, apSearch: '' }),
      // mobile: panel collapses to a magnifier button until opened
      apFabShow: isMobile && !s.apOpen,
      openApPanel: () => this.setState({ apOpen: true }),
      apCloseShow: isMobile,
      closeApPanel: () => this.setState({ apOpen: false, apSearch: '' }),
      apPanelDisp: (!isMobile || s.apOpen) ? 'flex' : 'none',
      apListTitle: isMobile
        ? (q && apAnchor ? 'Near ' + (apAnchor.city || apAnchor.name) : 'Search airports')
        : (q ? 'Search results' : 'Airports in view'),
      apListSub: isMobile
        ? (q && apAnchor
          ? apTotal + ' airport' + (apTotal === 1 ? '' : 's') + ' within 100 mi' + (apTotal > 30 ? ' — nearest 30' : '')
          : 'Type a city or airport to see fields within 100 miles')
        : (q
          ? apTotal + (apTotal === 1 ? ' match' : ' matches') + (apTotal > 30 ? ' — showing top 30' : '')
          : s.visibleCount + ' in this area — zoom to narrow'),
      visibleList: (isMobile
        ? (apNear ? apNear.map(([d, a]) => ({ a, d })) : [])
        : (apMatches || s.visible).map(a => ({ a, d: null }))
      ).map(({ a, d }) => ({
        iata: a.iata, name: a.name,
        loc: (a.city ? a.city + ', ' : '') + a.cc + (d !== null ? ' · ' + (d < 1 ? '<1' : Math.round(d)) + ' mi' : ''),
        chipBg: a.tier === 1 ? '#2E6BE6' : '#eef2f8', chipFg: a.tier === 1 ? '#fff' : '#16233b',
        tag: a.tier === 1 ? 'HUB' : '',
        onPick: () => {
          this.setState(isMobile ? { apSearch: '', apOpen: false } : (q ? { apSearch: '' } : {}));
          this.pickAirport(a);
        }
      })),

      // quotes view
      myRequests: s.requests.map(r => {
        const sel = r.id === s.activeReqId;
        const acc = s.accepted[r.id];
        const st = acc ? (
            r.tripStatus === 'confirmed' ? { status: 'CONFIRMED', statusBg: '#eef3fd', statusFg: '#2E6BE6' }
          : r.tripStatus === 'completed' ? { status: 'COMPLETED', statusBg: '#e8f6ee', statusFg: '#1e5e3c' }
          : r.tripStatus === 'cancelled' ? { status: 'CANCELLED', statusBg: '#fdecec', statusFg: '#b3261e' }
          : { status: 'ACCEPTED', statusBg: '#e8f6ee', statusFg: '#1e5e3c' })
          : r.closedAt ? (r.depositStatus === 'refunded'
              ? { status: 'REFUNDED', statusBg: '#eef2f8', statusFg: '#68758d' }
              : { status: 'CLOSED', statusBg: '#eef2f8', statusFg: '#68758d' })
          : r.status === 'collecting' ? { status: 'COLLECTING', statusBg: '#fdf6e3', statusFg: '#8a6d1f' }
          : { status: r.quotes.length + (r.quotes.length === 1 ? ' OFFER' : ' OFFERS'), statusBg: '#eef3fd', statusFg: '#2E6BE6' };
        return {
          route: this.routeStr(r), ...st,
          sub: this.fmtDate(r.legs[0].date) + ' · ' + r.pax + ' pax · posted ' + r.posted,
          bg: sel ? '#eef3fd' : '#fff', bd: sel ? '#2E6BE6' : '#e3e9f2',
          onSelect: () => this.setState({ activeReqId: r.id, compare: [], chatWith: null })
        };
      }),
      activeRoute: activeReq ? this.routeStr(activeReq) : '',
      activeSub: activeReq
        ? this.fmtDate(activeReq.legs[0].date) + (activeReq.legs.length > 1 ? ' – ' + this.fmtDate(activeReq.legs[activeReq.legs.length - 1].date) : '') + ' · ' + activeReq.id
          + (activeReq.depositStatus === 'held' ? ' · ' + this.fmtPrice(activeReq.depositAmount) + ' deposit held (demo, refundable)'
            : activeReq.depositStatus === 'kept' ? ' · ' + this.fmtPrice(activeReq.depositAmount) + ' deposit applied as platform fee'
            : activeReq.depositStatus === 'refunded' ? ' · deposit refunded'
            : activeReq.depositStatus === 'waived_first' ? ' · first request — no deposit'
            : activeReq.depositStatus === 'waived_plus' ? ' · deposit waived (Plus)' : '')
        : '',
      canClose: !!activeReq && !acceptedId && !activeReq.closedAt,
      closeActiveRequest: () => this.closeRequest(activeReq.id),
      closeLabel: activeReq && activeReq.depositStatus === 'held'
        ? 'None of these work — close & refund my deposit'
        : 'Close this request',
      activeChips: activeReq ? reqChips(activeReq) : [],
      isCollecting: !!activeReq && activeReq.status === 'collecting',
      notifiedOps: 42,
      // post-trip review (shown once a quote is accepted)
      ...(() => {
        if (!activeReq) return { rvStarsList: [], rvTitle: '', rvBtnLabel: '', rvText: '', rvMsg: false };
        const editing = s.rvFor === activeReq.id;
        const cur = editing ? { stars: s.rvStars, text: s.rvText }
          : (activeReq.review || { stars: 0, text: '' });
        return {
          rvTitle: activeReq.review && !editing ? 'YOUR REVIEW' : 'RATE YOUR TRIP',
          rvBtnLabel: activeReq.review ? 'Update review' : 'Submit review',
          rvStarsList: [1, 2, 3, 4, 5].map(n => ({
            color: n <= cur.stars ? '#f5a623' : '#dde5f0',
            onPick: () => this.setState({ rvFor: activeReq.id, rvStars: n, rvText: cur.text, rvMsg: '' })
          })),
          rvText: cur.text,
          onRvText: e => this.setState({ rvFor: activeReq.id, rvStars: cur.stars, rvText: e.target.value }),
          submitReview: () => this.submitReview(activeReq.id),
          rvMsg: s.rvMsg || false,
        };
      })(),
      hasAccepted: !!acceptedQuote,
      tripDocUrl: acceptedQuote && activeReq ? '/trip/' + activeReq.id : '',
      tripDocLabel: activeReq && activeReq.tripStatus === 'confirmed' ? 'Trip confirmation' : activeReq && activeReq.tripStatus === 'completed' ? 'Trip record' : 'Trip summary',
      opTripDocUrl: inboxChat && inboxChat.won ? '/trip/' + inboxChat.requestId : '',

      // concierge (any role) and the staff desk (team accounts only)
      conOpen: s.conOpen,
      conTitle: s.conTopic === 'operator' ? 'Message your partner manager' : 'Talk to a charter specialist',
      conIntro: s.conTopic === 'operator'
        ? 'Onboarding, verification, a request that looks off: tell us and a person on the Chartavia team replies.'
        : 'Not sure which cabin you need, or planning something unusual? A person on the Chartavia team reads this and replies by email or phone.',
      conContext: s.conReqId ? 'About trip ' + s.conReqId : false,
      conForm: !s.conDone,
      conDone: s.conDone ? 'Message received. Your reference is ' + s.conDone + '. We have emailed you a copy and will reply personally.' : false,
      conMsg: s.conMsg, onConMsg: e => this.setState({ conMsg: e.target.value, conErr: '' }),
      conPhone: s.conPhone, onConPhone: e => this.setState({ conPhone: e.target.value }),
      conErr: s.conErr || false,
      conSendLabel: s.conBusy ? 'Sending…' : 'Send to the concierge',
      sendConcierge: () => this.sendConcierge(),
      closeConcierge: () => this.setState({ conOpen: false }),
      openConciergeTrip: () => this.openConcierge('trip', null),
      openConciergeReq: () => this.openConcierge('trip', activeReq ? activeReq.id : null),
      openConciergeOp: () => this.openConcierge('operator', null),
      partnerName: this.partner ? this.partner.name : 'Chartavia Partner Desk',
      partnerTitle: this.partner ? this.partner.title : 'Operator partnerships',
      partnerInitials: (this.partner ? this.partner.name : 'Chartavia Partner').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(),

      isStaff: !!(this.me && this.me.isStaff),
      showStaff: !!s.staffOpen,
      goStaff: () => this.setState({ staffOpen: true, chatWith: null, menuOpen: false }),
      navStaffBg: s.staffOpen ? 'rgba(255,255,255,.13)' : 'transparent', navStaffFg: s.staffOpen ? '#ffffff' : '#b7c4dc',
      staffNewCount: (this.desk ? this.desk.newCount : 0) + (this.review ? this.review.readyCount + this.review.ratingCount : 0),
      staffTitle: 'Staff desk',
      staffSub: s.staffTab === 'operators'
        ? 'Approve operators before their first quote, clear aircraft the FAA data misses, and confirm safety ratings against the audit certificate.'
        : 'Messages from travelers, operators and the public page. Reply by email or phone, then mark them handled.',
      staffTabs: [
        ['messages', 'Messages', this.desk ? this.desk.newCount : 0],
        ['operators', 'Operators', this.review ? this.review.readyCount + this.review.ratingCount : 0]
      ].map(([id, label, count]) => {
        const on = s.staffTab === id;
        return {
          label, count, onPick: () => this.setState({ staffTab: id, staffMsg: '' }),
          bg: on ? '#16233b' : '#ffffff', fg: on ? '#ffffff' : '#4a5a76', bd: on ? '#16233b' : '#dde5f0',
          cBg: count ? '#c6a667' : (on ? 'rgba(255,255,255,.16)' : '#eef2f8'), cFg: count ? '#16233b' : (on ? '#ffffff' : '#68758d')
        };
      }),
      staffMsg: s.staffMsg || false,
      staffTabOps: s.staffTab === 'operators',
      staffOpsEmpty: s.staffTab === 'operators' && (!this.review || !this.review.items.length),
      staffOps: (s.staffTab === 'operators' && this.review ? this.review.items : []).map(o => {
        const c = o.clearance;
        const stage = {
          ready: { stLabel: 'READY FOR REVIEW', stBg: '#c6a667', stFg: '#16233b', bd: '#c6a667' },
          rating: { stLabel: 'RATING TO CONFIRM', stBg: '#c6a667', stFg: '#16233b', bd: '#c6a667' },
          approved: { stLabel: 'APPROVED', stBg: '#e8f6ee', stFg: '#1e5e3c', bd: '#e3e9f2' },
          declined: { stLabel: 'DECLINED', stBg: '#fdecec', stFg: '#b3261e', bd: '#e3e9f2' },
          incomplete: { stLabel: 'CHECKS INCOMPLETE', stBg: '#eef2f8', stFg: '#68758d', bd: '#e3e9f2' }
        }[o.stage];
        const look = (state, n) => state === 'done' ? { mark: '✓', bg: '#e8f6ee', fg: '#1e5e3c', bd: '#9fd8b6' }
          : state === 'stop' ? { mark: '!', bg: '#fdecec', fg: '#b3261e', bd: '#f3b9b4' }
          : { mark: String(n), bg: '#ffffff', fg: '#68758d', bd: '#cfd8e6' };
        const note = s.opNotes[o.orgId];
        if (o.message && o.review === 'pending') stage.stLabel = 'RESUBMITTED';
        return {
          ...stage, company: o.company,
          certLine: o.cert ? 'Certificate ' + o.cert + (o.faaName ? ' · FAA list: ' + o.faaName : ' · not on the FAA list') : 'No certificate number entered',
          holderLine: ['Account: ' + o.holder, o.email, o.base ? 'base ' + o.base : '', o.members ? o.members + ' team member' + (o.members > 1 ? 's' : '') : '', 'joined ' + o.joined].filter(Boolean).join(' · '),
          waiting: o.waiting ? 'Waiting since ' + o.waiting : false,
          steps: [
            { label: 'Certificate on the FAA Part 135 list', hint: o.faaName ? 'The company typed "' + o.company + '"; the FAA lists ' + o.faaName + '.' : 'No match yet.', ...look(c.certOk ? 'done' : 'todo', 1) },
            { label: 'Aircraft cleared to offer', hint: c.cleared.length ? c.cleared.join(', ') : 'None yet.', ...look(c.cleared.length ? 'done' : 'todo', 2) },
            { label: 'Account confirmed by staff', hint: o.review === 'approved' ? 'Approved for ' + o.cert + '.' : o.review === 'declined' ? 'Declined.' : 'Your decision. The FAA data cannot show who is behind the account.',
              ...look(o.review === 'approved' ? 'done' : o.review === 'declined' ? 'stop' : 'todo', 3) }
          ],
          noFleet: !o.fleet.length,
          fleet: o.fleet.map(a => {
            const st = a.cleared && a.staffOk ? { label: 'CLEARED BY STAFF', bg: '#e8f6ee', fg: '#1e5e3c' }
              : a.cleared ? { label: 'CLEARED', bg: '#e8f6ee', fg: '#1e5e3c' }
              : a.status === 'verified' && a.onCert === 0 ? { label: 'NOT ON CERTIFICATE', bg: '#fdecec', fg: '#b3261e' }
              : a.status === 'verified' ? { label: 'REGISTRY MATCH', bg: '#eef3fd', fg: '#2E6BE6' }
              : a.status === 'found' ? { label: 'MODEL NOT MATCHED', bg: '#eef3fd', fg: '#2E6BE6' }
              : a.status === 'mismatch' ? { label: 'MODEL MISMATCH', bg: '#fdecec', fg: '#b3261e' }
              : a.status === 'not_found' ? { label: 'NOT ON REGISTRY', bg: '#fdecec', fg: '#b3261e' }
              : { label: 'UNCHECKED', bg: '#eef2f8', fg: '#68758d' };
            return {
              tail: a.tail, model: a.model, status: st.label, statusBg: st.bg, statusFg: st.fg,
              faa: a.faaModel ? 'FAA registry: ' + (a.faaMfr || '') + ' ' + a.faaModel : 'The operator has not run the FAA check on this tail.',
              canClear: a.canClear, canUnclear: a.staffOk,
              onClear: () => this.staffOp(o.orgId, 'clear_aircraft', { aircraftId: a.id }),
              onUnclear: () => this.staffOp(o.orgId, 'unclear_aircraft', { aircraftId: a.id })
            };
          }),
          noDocs: !o.docs.length,
          docs: o.docs.map(d => ({ label: d.label, name: d.name, href: '/api/staff/operators/' + o.orgId + '/doc/' + d.kind })),
          ratingLine: !o.rating.claimed ? false : 'Claims ' + o.rating.claimed + (
            o.rating.confirmed && o.rating.expired
              ? (o.rating.expires ? ' · expired on ' + this.fmtDay(o.rating.expires) : ' · confirmed without an expiry date') + ', hidden from travelers'
                + (o.rating.newDoc ? ' · renewed certificate uploaded: confirm it with the new date' : o.rating.expires ? ' · waiting for the renewed certificate' : ': confirm again with the date')
            : o.rating.confirmed
              ? ' · confirmed, shown to travelers until ' + this.fmtDay(o.rating.expires) + (o.rating.daysLeft <= 30 ? ' (' + o.rating.daysLeft + ' days left)' : '')
                + (o.rating.newDoc ? ' · renewed certificate uploaded: confirm it with the new date' : '')
            : o.rating.hasDoc ? ' · audit certificate on file, not confirmed, hidden from travelers'
            : ' · no audit certificate uploaded, hidden from travelers'),
          canConfirmRating: !!o.rating.claimed && o.rating.hasDoc,
          confirmLabel: o.rating.confirmed ? 'Update expiry' : 'Confirm rating',
          expiry: s.opExpiry[o.orgId] != null ? s.opExpiry[o.orgId] : (o.rating.expires || ''),
          onExpiry: e => this.setState({ opExpiry: { ...s.opExpiry, [o.orgId]: e.target.value } }),
          canUnconfirmRating: o.rating.confirmed,
          onConfirmRating: () => this.staffOp(o.orgId, 'confirm_rating', { expires: s.opExpiry[o.orgId] != null ? s.opExpiry[o.orgId] : (o.rating.expires || '') }),
          onUnconfirmRating: () => this.staffOp(o.orgId, 'unconfirm_rating'),
          note: note != null ? note : o.note,
          onNote: e => this.setState({ opNotes: { ...s.opNotes, [o.orgId]: e.target.value } }),
          noteDirty: note != null && note !== o.note,
          onSaveNote: () => this.staffOp(o.orgId, 'note'),
          canApprove: o.review !== 'approved' && c.certOk,
          approveBlocked: o.review !== 'approved' && !c.certOk ? 'Approval is recorded against a certificate, so it opens once the number matches the FAA list.' : false,
          canDecline: o.review === 'pending',
          canRevoke: o.review !== 'pending',
          revokeLabel: o.review === 'approved' ? 'Withdraw approval' : 'Reopen review',
          onApprove: () => this.staffOp(o.orgId, 'approve'),
          onDecline: () => this.staffOp(o.orgId, 'decline', { reason: s.opReasons[o.orgId] || '' }),
          reason: s.opReasons[o.orgId] || '',
          onReason: e => this.setState({ opReasons: { ...s.opReasons, [o.orgId]: e.target.value } }),
          reasonLine: o.reason && o.review !== 'approved' ? (o.review === 'declined' ? 'Declined. You asked for: ' : 'Declined earlier. You asked for: ') + o.reason : false,
          messageLine: o.message && o.review === 'pending' ? o.message : false,
          onRevoke: () => this.staffOp(o.orgId, 'revoke'),
          mailHref: 'mailto:' + o.email + '?subject=' + encodeURIComponent('Your Chartavia operator account'),
          last: o.last || false
        };
      }),
      staffEmpty: s.staffTab === 'messages' && (!this.desk || !this.desk.items.length),
      staffRows: (s.staffTab === 'messages' && this.desk ? this.desk.items : []).map(c => {
        const st = c.status === 'new' ? { stLabel: 'NEW', stBg: '#c6a667', stFg: '#16233b', bd: '#c6a667' }
          : c.status === 'open' ? { stLabel: 'IN PROGRESS', stBg: '#eef3fd', stFg: '#2E6BE6', bd: '#e3e9f2' }
          : { stLabel: 'HANDLED', stBg: '#eef2f8', stFg: '#68758d', bd: '#e3e9f2' };
        return {
          ...st, ref: c.ref, name: c.name, topicLabel: c.topicLabel.toUpperCase(), message: c.message, note: c.note || false,
          meta: [c.email, c.phone, c.member ? (c.member === 'operator' ? 'Operator account' : 'Traveler account') : 'Public page', c.requestId, c.ago].filter(Boolean).join(' · '),
          mailHref: 'mailto:' + c.email + '?subject=' + encodeURIComponent('Your Chartavia enquiry (' + c.ref + ')'),
          canOpen: c.status === 'new', canClose: c.status !== 'closed', canReopen: c.status === 'closed',
          onOpen: () => this.staffSet(c.id, 'open'), onClose: () => this.staffSet(c.id, 'closed'), onReopen: () => this.staffSet(c.id, 'open'),
        };
      }),
      ...(() => {
        if (!acceptedQuote || !activeReq) return { bannerText: '', clientCanCancel: false, canReview: false };
        const base = acceptedQuote.op + ' · ' + acceptedQuote.aircraft + ' · ' + this.fmtPrice(acceptedQuote.price)
          + (activeReq.depositStatus === 'kept'
            ? ' · ' + this.fmtPrice(activeReq.depositAmount) + ' deposit applied as platform fee (demo)'
            : ' · no platform fee (deposit waived)');
        const ts = activeReq.tripStatus || 'accepted';
        const bannerText = ts === 'confirmed' ? 'Trip confirmed. ' + base + ' — your aircraft is locked in.'
          : ts === 'completed' ? 'Trip completed. ' + base + ' — how was it? Leave a review below.'
          : ts === 'cancelled' ? 'Trip cancelled. ' + base
          : 'Offer accepted. ' + base + ' — message the operator to finalize contract & payment.';
        return {
          bannerText,
          clientCanCancel: ts === 'accepted' || ts === 'confirmed',
          clientCancelTrip: () => this.tripAction(activeReq.id, 'cancel', 'Cancel this trip?'),
          canReview: ts === 'completed' || !!activeReq.review,
        };
      })(),
      acceptedText: acceptedQuote
        ? acceptedQuote.op + ' · ' + acceptedQuote.aircraft + ' · ' + this.fmtPrice(acceptedQuote.price)
        : '',
      hasCompare: s.compare.length >= 2, compareCount: s.compare.length,
      clearCompare: () => this.setState({ compare: [] }),
      compareCards: quotes.filter(q => s.compare.includes(q.id)).map(q => ({
        op: q.op, aircraft: q.aircraft + (q.year ? ' (' + q.year + ')' : ''), price: this.fmtPrice(q.price),
        safety: q.safety, rating: q.rating + ' ★ · ' + q.reviews + ' review' + (q.reviews === 1 ? '' : 's'), seats: q.seats, resp: q.resp
      })),
      quoteCards: quotes.map(q => {
        const inCmp = s.compare.includes(q.id);
        const isAcc = acceptedId === q.id;
        return {
          op: q.op, safety: q.safety, photo: q.photo || false,
          // accepted offer only: the certificate holder's name and number as the FAA lists them
          opLegal: q.opLegal || false, opCert: q.opCert || '',
          art: this.acArt(this.acClass(q.aircraft, q.seats)),
          artLabel: { prop: 'TURBOPROP', light: 'LIGHT CABIN', mid: 'MID CABIN', heavy: 'LARGE CABIN' }[this.acClass(q.aircraft, q.seats)],
          aircraft: q.aircraft, year: q.year, seats: q.seats,
          spec: [q.aircraft, parseInt(q.seats, 10) ? q.seats + ' seats' : '', q.year].filter(Boolean).join(' · '),
          rating: q.rating, reviews: q.reviews, resp: q.resp, valid: q.valid,
          price: this.fmtPrice(q.price), emptyLeg: q.emptyLeg, discount: q.discount || '', note: q.note || false,
          bd: isAcc ? '#38a169' : inCmp ? '#2E6BE6' : '#e3e9f2',
          cmpBd: inCmp ? '#2E6BE6' : '#dde5f0', cmpBg: inCmp ? '#eef3fd' : '#fff', cmpFg: inCmp ? '#2E6BE6' : '#16233b',
          cmpLabel: inCmp ? '✓ Comparing' : 'Compare',
          msgLabel: q.unread ? 'Message (' + q.unread + ' new)' : 'Message',
          onCompare: () => this.setState({ compare: inCmp ? s.compare.filter(x => x !== q.id) : [...s.compare, q.id].slice(-3) }),
          onChat: () => { this.setState({ chatWith: q.id, ctMsg: '', chats: s.chats[q.id] ? s.chats : { ...s.chats, [q.id]: [] } }); this.loadChat(q.id); },
          acceptBg: isAcc ? '#38a169' : acceptedId ? '#eef2f8' : '#16233b',
          acceptFg: isAcc ? '#fff' : acceptedId ? '#a9b4c8' : '#fff',
          acceptLabel: isAcc ? '✓ Accepted' : 'Accept offer',
          onAccept: () => { if (!acceptedId) this.acceptQuote(activeReq.id, q.id); }
        };
      }),
      chatOpen: !!chatQuote || !!inboxChat,
      chatName: chatQuote ? chatQuote.op : (inboxChat ? inboxChat.client + ' · ' + this.routeStr(inboxChat) : ''),

      // deposit modal (client)
      depOpen: s.depOpen,
      depAmountText: this.fmtPrice(s.depAmount),
      confirmDeposit: () => this.confirmDeposit(),
      cancelDeposit: () => { this._pendingBody = null; this.setState({ depOpen: false }); },

      // anonymity notice for operators pre-acceptance
      opAnonNote: !!(inboxChat && !inboxChat.won),

      // trip lifecycle controls in the chat drawer (winning operator only)
      ...(() => {
        if (!inboxChat || !inboxChat.won) return { tripShow: false, tripStatusLabel: '', tripCanConfirm: false, tripCanComplete: false, tripCanCancel: false };
        const ts = inboxChat.tripStatus || 'accepted';
        return {
          tripShow: true,
          tripStatusLabel: ts === 'confirmed' ? 'Confirmed — fly, then mark completed'
            : ts === 'completed' ? 'Completed'
            : ts === 'cancelled' ? 'Cancelled'
            : 'Accepted — confirm to lock in the aircraft',
          tripCanConfirm: ts === 'accepted',
          tripConfirm: () => this.tripAction(inboxChat.requestId, 'confirm'),
          tripCanComplete: ts === 'confirmed',
          tripComplete: () => this.tripAction(inboxChat.requestId, 'complete'),
          tripCanCancel: ts === 'accepted' || ts === 'confirmed',
          tripCancel: () => this.tripAction(inboxChat.requestId, 'cancel', 'Cancel this trip?'),
        };
      })(),

      // contract section in the chat drawer
      ctShow: !!inboxChat || !!(chatQuote && chatQuote.contract),
      ctIsOp: !!inboxChat,
      ctHas: !!(inboxChat ? inboxChat.contract : (chatQuote && chatQuote.contract)),
      ctName: (inboxChat && inboxChat.contract) ? inboxChat.contract.name : (chatQuote && chatQuote.contract) ? chatQuote.contract.name : '',
      ctHref: (inboxChat && inboxChat.contract) ? inboxChat.contract.url : (chatQuote && chatQuote.contract) ? chatQuote.contract.url : '',
      onCtFile: e => { const f = e.target.files && e.target.files[0]; if (f) { this.uploadContract(f); e.target.value = ''; } },
      ctLink: s.ctLink, onCtLink: e => this.setState({ ctLink: e.target.value }),
      attachCtLink: () => this.attachContractLink(),
      ctMsg: s.ctMsg || false,
      closeChat: () => this.setState({ chatWith: null }),
      chatMsgs: (s.chats[s.chatWith] || []).map(m => m.who === 'me'
        ? { text: m.text, align: 'flex-end', bg: '#2E6BE6', fg: '#fff' }
        : { text: m.text, align: 'flex-start', bg: '#eef2f8', fg: '#16233b' }),
      chatText: s.chatText, onChatText: e => this.setState({ chatText: e.target.value }),
      onChatKey: e => { if (e.key === 'Enter') this.sendChat(); },
      sendChat: () => this.sendChat(),

      // operator
      rfqList: s.marketplace.map(r => {
        const sel = r.id === s.opSelId;
        const bid = s.opBids[r.id];
        return {
          route: this.routeStr(r),
          status: bid ? 'QUOTE SENT' : r.posted.includes('min') ? 'NEW' : 'OPEN',
          statusBg: bid ? '#e8f6ee' : r.posted.includes('min') ? '#eef3fd' : '#eef2f8',
          statusFg: bid ? '#1e5e3c' : r.posted.includes('min') ? '#2E6BE6' : '#68758d',
          sub: this.fmtDate(r.legs[0].date) + ' · ' + r.pax + ' pax · ' + r.cats.map(catLabel).join(', ') + ' · ' + r.budget,
          posted: 'Posted ' + r.posted, bids: (r.bids ?? (r.quotes ? r.quotes.length : 0)),
          bg: sel ? '#eef3fd' : '#fff', bd: sel ? '#2E6BE6' : '#e3e9f2',
          onSelect: () => this.setState({ opSelId: r.id })
        };
      }),
      // operator inbox
      hasInbox: s.role === 'operator' && s.inbox.length > 0,
      inboxItems: s.inbox.map(c => {
        const sel = c.quoteId === s.chatWith;
        const badge = c.unread ? c.unread + ' NEW'
          : c.tripStatus === 'confirmed' ? 'CONFIRMED'
          : c.tripStatus === 'completed' ? 'COMPLETED'
          : c.tripStatus === 'cancelled' ? 'CANCELLED'
          : c.won ? 'WON'
          : c.msgCount ? c.msgCount + (c.msgCount > 1 ? ' MSGS' : ' MSG') : '';
        return {
          route: this.routeStr(c), client: c.client,
          preview: c.lastMsg || ('Your quote: ' + this.fmtPrice(c.price) + ' — no messages yet'),
          badge,
          badgeBg: c.unread ? '#2E6BE6' : c.tripStatus === 'cancelled' ? '#fdecec' : c.won ? '#e8f6ee' : '#eef3fd',
          badgeFg: c.unread ? '#ffffff' : c.tripStatus === 'cancelled' ? '#b3261e' : c.won ? '#1e5e3c' : '#2E6BE6',
          bg: sel ? '#eef3fd' : '#fff', bd: sel ? '#2E6BE6' : '#e3e9f2',
          onOpen: () => {
            this.setState({ chatWith: c.quoteId, ctMsg: '', chats: s.chats[c.quoteId] ? s.chats : { ...s.chats, [c.quoteId]: [] } });
            this.loadChat(c.quoteId);
          }
        };
      }),

      rfqRoute: rfq ? this.routeStr(rfq) : '',
      rfqSub: rfq ? (rfq.id + ' · posted ' + rfq.posted) : '',
      rfqLegs: rfq ? rfq.legs.map((l, i) => ({
        tag: rfq.type === 'round' ? (i === 0 ? 'OUT' : 'RETURN') : 'LEG ' + (i + 1),
        from: l.from, to: l.to,
        when: this.fmtDate(l.date) + ' · ' + l.time + (rfq.flexDays ? ' (± ' + rfq.flexDays + 'd)' : '')
      })) : [],
      rfqChips: rfq ? reqChips(rfq) : [],
      rfqNotes: rfq && rfq.notes ? rfq.notes : false,
      bidSent: !!rfqBid, bidFormVisible: !rfqBid && gateOk,
      // FAA verification gate
      bidGate: !rfqBid && !gateOk,
      gateSteps: this.gateSteps(),
      gateKicker: gateWhy === 'review_pending' ? 'IN REVIEW' : gateWhy === 'review_declined' ? 'ACCOUNT REVIEW' : 'VERIFICATION REQUIRED',
      gateTitle: gateWhy === 'review_pending' ? 'Your account is with the Chartavia team'
        : gateWhy === 'review_declined' ? 'We could not approve this account yet'
        : 'Quoting opens once you are verified',
      gateBody: gateWhy === 'review_pending'
        ? 'Your certificate and aircraft passed the FAA checks. Before your first quote, a member of our team confirms that this account belongs to the certificate holder. You can review every request in the meantime.'
        : gateWhy === 'review_declined'
        ? 'Quoting stays locked until the point below is resolved. When it is, resubmit for review from your operator profile.'
        : 'Travelers on Chartavia only receive offers from verified Part 135 operators. You can review every request now; sealed quotes unlock when the three checks below are complete.',
      gateCta: opIsAdmin && gateWhy === 'review_declined' ? 'Open profile to resubmit'
        : opIsAdmin && gateWhy !== 'review_pending' ? 'Complete verification' : 'View operator profile',
      canResubmit: gateWhy === 'review_declined' && opIsAdmin,
      resubmitMember: gateWhy === 'review_declined' && !opIsAdmin,
      rsMsg: s.rsMsg, onRsMsg: e => this.setState({ rsMsg: e.target.value, rsErr: '' }),
      rsErr: s.rsErr || false, rsLabel: s.rsBusy ? 'Sending…' : 'Resubmit for review',
      resubmitReview: () => this.resubmitReview(),
      gateMember: !opIsAdmin,
      gateHeadline: gateOk ? 'Cleared to quote' : gateWhy === 'review_pending' ? 'In review' : gateWhy === 'review_declined' ? 'Not approved yet' : 'Quoting is locked',
      gateSub: gateOk
        ? 'You can send sealed quotes and post empty legs with your cleared aircraft.'
        : gateWhy === 'review_pending' ? 'The automatic checks passed. Quoting opens when our team approves your account.'
        : gateWhy === 'review_declined' ? 'See what we need under the third check, put it in place, then resubmit below.'
        : 'Sealed quotes and empty legs open once the three checks below pass.',
      gateBg: gateOk ? '#f1faf5' : '#fbf8f0', gateBd: gateOk ? '#9fd8b6' : '#e6dcc3', gateFg: gateOk ? '#1e5e3c' : '#8a6b2e',
      fleet: this.quotable().map(a => ({ id: 'tail:' + a.tail, label: a.model_claim + ' — ' + a.tail })),
      bidAircraft: s.bidAircraft, onBidAircraft: e => this.setState({ bidAircraft: e.target.value }),
      bidPrice: s.bidPrice, onBidPrice: e => this.setState({ bidPrice: e.target.value }),
      bidMsg: s.bidMsg, onBidMsg: e => this.setState({ bidMsg: e.target.value }),
      bidEmpty: s.bidEmpty, onBidEmpty: e => this.setState({ bidEmpty: e.target.checked }),
      bidValid: s.bidValid, onBidValid: e => this.setState({ bidValid: e.target.value }),
      submitBid: () => { if (rfq) this.submitBid(rfq); }
    };
  }
  sendChat() {
    const s = this.state;
    const t = s.chatText.trim();
    if (!t || !s.chatWith) return;
    const quoteId = s.chatWith;
    const msgs = [...(s.chats[quoteId] || []), { who: 'me', text: t }];
    this.setState({ chats: { ...s.chats, [quoteId]: msgs }, chatText: '' });
    this.api('/api/quotes/' + quoteId + '/messages', { body: { text: t } })
      .then(() => this.loadChat(quoteId))
      .catch(e => alert(e.message));
  }
}
