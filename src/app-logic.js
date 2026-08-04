
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
    this.FLEET = [
      { id: 'p300', label: 'Phenom 300E — Light, 7 seats' },
      { id: 'xls', label: 'Citation XLS Gen2 — Midsize, 9 seats' },
      { id: 'c350', label: 'Challenger 350 — Super-mid, 9 seats' },
      { id: 'g450', label: 'Gulfstream G450 — Heavy, 14 seats' }
    ];
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
      bidAircraft: 'xls', bidPrice: '', bidMsg: '', bidEmpty: false, bidValid: '48',
      menuOpen: false, profileName: '', pwCurrent: '', pwNew: '', acctMsg: '', showEL: true,
      ctLink: '', ctMsg: '', checkoutOpen: false, apSearch: '',
      profileOpen: false, prCompany: '', prCert: '', prBase: '', prTail: '', prModel: '', prMsg: '',
      prSafety: '',
      rvFor: null, rvStars: 0, rvText: '', rvMsg: '',
      emptyLegs: [], myLegs: [],
      legFormOpen: false, legFrom: '', legTo: '', legDate: '', legTime: '09:00',
      legAircraft: 'xls', legPrice: '', legNote: '', legMsg: '',
      depOpen: false, depAmount: 0
    };
    this.DEPOSIT_TIERS = { prop: 150, light: 150, mid: 250, smid: 250, heavy: 500, ulr: 500 };
    this.opProfile = null;
  }
  ap(code) { return this.airports ? this.airports.find(a => a.iata === code) : null; }
  fmtDate(d) { const dt = new Date(d + 'T12:00'); return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  fmtPrice(p) { return '$' + p.toLocaleString('en-US'); }
  routeStr(r) { const codes = [r.legs[0].from, ...r.legs.map(l => l.to)]; if (r.type === 'round') return r.legs[0].from + ' ⇄ ' + r.legs[0].to; return codes.join(' → '); }

  api(path, opts) {
    return fetch(path, opts && opts.body ? {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body)
    } : undefined).then(r => r.json().then(d => {
      if (!r.ok) { const e = new Error(d.error || 'Request failed'); e.code = d.code; throw e; }
      return d;
    }));
  }

  loadData() {
    return this.api('/api/bootstrap').then(d => {
      this.me = d.me;
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
        const patch = {
          role: 'operator', view: 'operator', userInitials: initials,
          marketplace: d.marketplace, opBids, inbox: d.inbox || [], myLegs: d.myEmptyLegs || [],
          opSelId: keep ? this.state.opSelId : (d.marketplace[0] ? d.marketplace[0].id : null)
        };
        const fleet = this.opProfile ? this.opProfile.fleet : [];
        if (fleet.length && !fleet.some(a => 'tail:' + a.tail === this.state.bidAircraft)) {
          patch.bidAircraft = 'tail:' + fleet[0].tail;
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
    this.loadData();
    this._poll = setInterval(() => this.loadData(), 7000);
  }
  componentWillUnmount() {
    window.removeEventListener('message', this._onMsg);
    if (this._poll) clearInterval(this._poll);
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
    this.setState({ legs, active: next }, () => this.drawRoutes());
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
    }).catch(e => this.setState({ legMsg: e.message })).then(() => { this._legging = false; });
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
      .then(d => { this.setState({ prMsg: d.certOk ? 'Saved.' : 'Saved — certificate number looks unusual, double-check it.' }); this.loadData(); })
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
        onFromClick: () => this.setState({ active: { leg: i, side: 'from' } }),
        onToClick: () => this.setState({ active: { leg: i, side: 'to' } }),
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
    const q = s.apSearch.trim().toUpperCase();
    let apMatches = null, apTotal = 0;
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
      profBadgeBg: this.opProfile && this.opProfile.badge === 'FAA-checked fleet' ? '#e8f6ee'
        : this.opProfile && this.opProfile.badge !== 'Unverified' ? '#e7eefc' : '#eef2f8',
      profBadgeFg: this.opProfile && this.opProfile.badge === 'FAA-checked fleet' ? '#1e5e3c'
        : this.opProfile && this.opProfile.badge !== 'Unverified' ? '#2E6BE6' : '#68758d',
      prCompany: s.prCompany, onPrCompany: e => this.setState({ prCompany: e.target.value }),
      prCert: s.prCert, onPrCert: e => this.setState({ prCert: e.target.value }),
      prBase: s.prBase, onPrBase: e => this.setState({ prBase: e.target.value }),
      saveOpProfile: () => this.saveOpProfile(),
      prFleet: (this.opProfile ? this.opProfile.fleet : []).map(a => {
        const st = a.faa_status === 'verified' ? { label: 'FAA MATCH', bg: '#e8f6ee', fg: '#1e5e3c' }
          : a.faa_status === 'found' ? { label: 'ON REGISTRY', bg: '#e7eefc', fg: '#2E6BE6' }
          : a.faa_status === 'mismatch' ? { label: 'MODEL MISMATCH', bg: '#fdecec', fg: '#b3261e' }
          : a.faa_status === 'not_found' ? { label: 'NOT FOUND', bg: '#fdecec', fg: '#b3261e' }
          : { label: 'UNCHECKED', bg: '#eef2f8', fg: '#68758d' };
        const isAdm = !!(this.opProfile && this.opProfile.team && this.opProfile.team.myOrgRole === 'admin');
        return {
          tail: a.tail, model: a.model_claim,
          status: st.label, statusBg: st.bg, statusFg: st.fg,
          faaInfo: a.faa_model ? 'FAA registry: ' + (a.faa_mfr || '') + ' ' + a.faa_model : false,
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
      onCertDocFile: e => { const f = e.target.files && e.target.files[0]; if (f) { this.uploadCertDoc(f); e.target.value = ''; } },
      certDocName: (this.opProfile && this.opProfile.profile && this.opProfile.profile.cert_doc_name) || '',
      hasCertDoc: !!(this.opProfile && this.opProfile.profile && this.opProfile.profile.cert_doc_name),

      // team (org) management
      prIsAdmin: !!(this.opProfile && this.opProfile.team && this.opProfile.team.myOrgRole === 'admin'),
      prIsMember: !!(this.opProfile && this.opProfile.team && this.opProfile.team.myOrgRole === 'member'),
      teamMembers: (this.opProfile && this.opProfile.team ? this.opProfile.team.members : []).map(u => ({
        name: u.name, email: u.email,
        roleLabel: u.org_role === 'admin' ? 'ADMIN' : 'MEMBER',
        roleBg: u.org_role === 'admin' ? '#e7eefc' : '#eef2f8',
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
        : this.me.plan === 'plus' ? 'Slipstream Plus'
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
      coTag: realRole === 'operator' ? 'SLIPSTREAM PRO' : 'SLIPSTREAM PLUS',
      coName: realRole === 'operator' ? 'Operator Pro' : 'Traveler Plus',
      coPrice: realRole === 'operator' ? '$299' : '$79',
      coFeatures: realRole === 'operator'
        ? [{ label: 'See new requests instantly (free tier waits 15 min)' }, { label: 'Priority placement — your quotes list first' }, { label: 'Win-rate analytics on your bidding' }, { label: 'Unlimited team seats (free: 3)' }, { label: '20 empty-leg slots (free: 3)' }]
        : [{ label: 'Request deposits waived on every trip' }, { label: 'Empty-leg deal alerts' }, { label: 'Priority support' }, { label: 'Cancellation assistance' }],
      coComplete: () => this.completeCheckout(),
      coCancel: () => this.setState({ checkoutOpen: false }),
      roleClient: () => { if (realRole === 'client') this.setState({ role: 'client', view: s.view === 'operator' ? 'request' : s.view, chatWith: null }); },
      roleOperator: () => { if (realRole === 'operator') this.setState({ role: 'operator', view: 'operator', chatWith: null }); },
      roleCliBg: seg(s.role === 'client').bg, roleCliFg: seg(s.role === 'client').fg, roleCliSh: seg(s.role === 'client').sh,
      roleOpBg: seg(s.role === 'operator').bg, roleOpFg: seg(s.role === 'operator').fg, roleOpSh: seg(s.role === 'operator').sh,
      goRequest: () => this.setState({ view: 'request', chatWith: null }),
      goQuotes: () => this.setState({ view: 'quotes' }),
      goDeals: () => this.setState({ view: 'deals', chatWith: null }),
      navReqBg: s.view === 'request' ? '#eef2f8' : 'transparent', navReqFg: s.view === 'request' ? '#16233b' : '#68758d',
      navQuoBg: s.view === 'quotes' ? '#eef2f8' : 'transparent', navQuoFg: s.view === 'quotes' ? '#16233b' : '#68758d',
      navDealBg: s.view === 'deals' ? '#eef2f8' : 'transparent', navDealFg: s.view === 'deals' ? '#16233b' : '#68758d',
      myRequestCount: s.requests.length, openRfqCount: s.marketplace.length,
      dealCount: s.emptyLegs.length,
      showRequest: s.role === 'client' && s.view === 'request',
      showQuotes: s.role === 'client' && s.view === 'quotes',
      showDeals: s.role === 'client' && s.view === 'deals',
      showOperator: s.role === 'operator',

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
        const fleetOpts = (this.opProfile && this.opProfile.fleet.length)
          ? 'tail:' + this.opProfile.fleet[0].tail : 'xls';
        this.setState({ legFormOpen: true, legMsg: '', legAircraft: fleetOpts, menuOpen: false });
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
      mapSrc: (window.__resources && window.__resources.mapPage) || './map.html',
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
      apListTitle: q ? 'Search results' : 'Airports in view',
      apListSub: q
        ? apTotal + (apTotal === 1 ? ' match' : ' matches') + (apTotal > 30 ? ' — showing top 30' : '')
        : s.visibleCount + ' in this area — zoom to narrow',
      visibleList: (apMatches || s.visible).map(a => ({
        iata: a.iata, name: a.name, loc: (a.city ? a.city + ', ' : '') + a.cc,
        chipBg: a.tier === 1 ? '#2E6BE6' : '#eef2f8', chipFg: a.tier === 1 ? '#fff' : '#16233b',
        tag: a.tier === 1 ? 'HUB' : '',
        onPick: () => { if (q) this.setState({ apSearch: '' }); this.pickAirport(a); }
      })),

      // quotes view
      myRequests: s.requests.map(r => {
        const sel = r.id === s.activeReqId;
        const acc = s.accepted[r.id];
        const st = acc ? (
            r.tripStatus === 'confirmed' ? { status: 'CONFIRMED', statusBg: '#e7eefc', statusFg: '#2E6BE6' }
          : r.tripStatus === 'completed' ? { status: 'COMPLETED', statusBg: '#e8f6ee', statusFg: '#1e5e3c' }
          : r.tripStatus === 'cancelled' ? { status: 'CANCELLED', statusBg: '#fdecec', statusFg: '#b3261e' }
          : { status: 'ACCEPTED', statusBg: '#e8f6ee', statusFg: '#1e5e3c' })
          : r.closedAt ? (r.depositStatus === 'refunded'
              ? { status: 'REFUNDED', statusBg: '#eef2f8', statusFg: '#68758d' }
              : { status: 'CLOSED', statusBg: '#eef2f8', statusFg: '#68758d' })
          : r.status === 'collecting' ? { status: 'COLLECTING', statusBg: '#fdf6e3', statusFg: '#8a6d1f' }
          : { status: r.quotes.length + ' QUOTES', statusBg: '#e7eefc', statusFg: '#2E6BE6' };
        return {
          route: this.routeStr(r), ...st,
          sub: this.fmtDate(r.legs[0].date) + ' · ' + r.pax + ' pax · posted ' + r.posted,
          bg: sel ? '#eef3fb' : '#fff', bd: sel ? '#2E6BE6' : '#e3e9f2',
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
          : 'Quote accepted. ' + base + ' — message the operator to finalize contract & payment.';
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
          aircraft: q.aircraft, year: q.year, seats: q.seats,
          rating: q.rating, reviews: q.reviews, resp: q.resp, valid: q.valid,
          price: this.fmtPrice(q.price), emptyLeg: q.emptyLeg, discount: q.discount || '', note: q.note || false,
          bd: isAcc ? '#38a169' : inCmp ? '#2E6BE6' : '#e3e9f2',
          cmpBd: inCmp ? '#2E6BE6' : '#dde5f0', cmpBg: inCmp ? '#e7eefc' : '#fff', cmpFg: inCmp ? '#2E6BE6' : '#16233b',
          cmpLabel: inCmp ? '✓ Comparing' : 'Compare',
          msgLabel: q.unread ? 'Message (' + q.unread + ' new)' : 'Message',
          onCompare: () => this.setState({ compare: inCmp ? s.compare.filter(x => x !== q.id) : [...s.compare, q.id].slice(-3) }),
          onChat: () => { this.setState({ chatWith: q.id, ctMsg: '', chats: s.chats[q.id] ? s.chats : { ...s.chats, [q.id]: [] } }); this.loadChat(q.id); },
          acceptBg: isAcc ? '#38a169' : acceptedId ? '#eef2f8' : '#16233b',
          acceptFg: isAcc ? '#fff' : acceptedId ? '#a9b4c8' : '#fff',
          acceptLabel: isAcc ? '✓ Accepted' : 'Accept quote',
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
          statusBg: bid ? '#e8f6ee' : r.posted.includes('min') ? '#e7eefc' : '#eef2f8',
          statusFg: bid ? '#1e5e3c' : r.posted.includes('min') ? '#2E6BE6' : '#68758d',
          sub: this.fmtDate(r.legs[0].date) + ' · ' + r.pax + ' pax · ' + r.cats.map(catLabel).join(', ') + ' · ' + r.budget,
          posted: 'Posted ' + r.posted, bids: (r.bids ?? (r.quotes ? r.quotes.length : 0)),
          bg: sel ? '#eef3fb' : '#fff', bd: sel ? '#2E6BE6' : '#e3e9f2',
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
          badgeBg: c.unread ? '#2E6BE6' : c.tripStatus === 'cancelled' ? '#fdecec' : c.won ? '#e8f6ee' : '#e7eefc',
          badgeFg: c.unread ? '#ffffff' : c.tripStatus === 'cancelled' ? '#b3261e' : c.won ? '#1e5e3c' : '#2E6BE6',
          bg: sel ? '#eef3fb' : '#fff', bd: sel ? '#2E6BE6' : '#e3e9f2',
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
      bidSent: !!rfqBid, bidFormVisible: !rfqBid,
      fleet: (this.opProfile && this.opProfile.fleet.length)
        ? this.opProfile.fleet.map(a => ({
            id: 'tail:' + a.tail,
            label: a.model_claim + ' — ' + a.tail + (a.faa_status === 'verified' ? ' ✓ FAA' : '')
          }))
        : this.FLEET,
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
