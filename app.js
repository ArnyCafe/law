/* 勞基法法典 — app.js
 * 純前端、無相依套件。所有使用者資料（註記、螢光、手寫、書籤、自訂判決函釋）
 * 存在本機 IndexedDB（失敗時退回 localStorage），可於「設定」匯出 / 匯入備份。
 */
(function () {
  'use strict';

  const D = window.LSA_DATA;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ------------------------------------------------------------------ *
   * storage: IndexedDB key/value with in-memory cache
   * ------------------------------------------------------------------ */
  const Store = {
    cache: new Map(), db: null, mode: 'memory', LS: 'lsa-codex:',
    async init() {
      try {
        this.db = await new Promise((res, rej) => {
          const r = indexedDB.open('lsa-codex', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        const tx = this.db.transaction('kv');
        const st = tx.objectStore('kv');
        const [keys, vals] = await Promise.all([req(st.getAllKeys()), req(st.getAll())]);
        keys.forEach((k, i) => this.cache.set(k, vals[i]));
        this.mode = 'idb';
      } catch (e) {
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith(this.LS)) this.cache.set(k.slice(this.LS.length), JSON.parse(localStorage.getItem(k)));
          }
          this.mode = 'ls';
        } catch (e2) { this.mode = 'memory'; }
      }
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
      function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
    },
    get(k, d) { return this.cache.has(k) ? this.cache.get(k) : d; },
    set(k, v) {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return this.del(k);
      this.cache.set(k, v);
      this._write(k, v);
    },
    del(k) { this.cache.delete(k); this._write(k, undefined); },
    keys(prefix = '') { return [...this.cache.keys()].filter((k) => k.startsWith(prefix)); },
    _write(k, v) {
      try {
        if (this.mode === 'idb') {
          const st = this.db.transaction('kv', 'readwrite').objectStore('kv');
          v === undefined ? st.delete(k) : st.put(v, k);
        } else if (this.mode === 'ls') {
          v === undefined ? localStorage.removeItem(this.LS + k) : localStorage.setItem(this.LS + k, JSON.stringify(v));
        }
      } catch (e) { toast('儲存失敗：' + e.message); }
    },
    async clearAll() {
      for (const k of [...this.cache.keys()]) this.del(k);
    },
  };

  /* ------------------------------------------------------------------ *
   * data helpers
   * ------------------------------------------------------------------ */
  const ARTS = D.articles;
  const ART = new Map(ARTS.map((a) => [a.no, a]));
  const ORDER = new Map(ARTS.map((a, i) => [a.no, i]));
  const label = (no) => (no.includes('-') ? `第${no.split('-')[0]}條之${no.split('-')[1]}` : `第${no}條`);
  const shortLabel = (no) => (no.includes('-') ? `${no.split('-')[0]}之${no.split('-')[1]}` : no);
  const chName = (ch) => (ch || '').replace(/\s+/g, ' ').replace(/^第 (.+?) 章/, (m, x) => `第${x.replace(/ /g, '')}章`);
  const rocDate = (d) => `${+d.slice(0, 4) - 1911}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
  const artText = (a) => a.lines.map((l) => l.t).join('\n');
  const sortNos = (arr) => [...new Set(arr)].sort((a, b) => (ORDER.get(a) ?? 999) - (ORDER.get(b) ?? 999));

  // article → amendment list
  const ART_CHANGES = new Map();
  D.amendments.forEach((am) => am.changes.forEach((c) => {
    if (!ART_CHANGES.has(c.no)) ART_CHANGES.set(c.no, []);
    ART_CHANGES.get(c.no).push({ am, c });
  }));

  function versionsOf(no) {
    const list = ART_CHANGES.get(no) || [];
    const cur = ART.get(no);
    if (!list.length) return [{ date: D.amendments[0].date, lines: cur ? cur.lines : [], kind: '制定' }];
    const out = [];
    if (list[0].c.type !== 'add') out.push({ date: D.amendments[0].date, lines: list[0].c.old, kind: '制定' });
    list.forEach(({ am, c }) => out.push({ date: am.date, lines: c.new, kind: c.type === 'add' ? '增訂' : c.type === 'del' ? '刪除' : '修正' }));
    return out;
  }

  // cases: built-in (curated) + 大法官解釋 + user
  const BUILTIN_CASES = [
    ...D.interps.map((j) => ({ id: j.id, type: 'J', title: j.title, date: j.date, topic: j.issue, summary: j.holding, arts: j.arts, url: j.url, src: '全國法規資料庫' })),
    ...(D.cases || []),
  ];
  const TYPE_NAME = { J: '大法官解釋', S: '判決', A: '函釋', O: '其他' };
  function allCases() { return [...BUILTIN_CASES, ...Store.get('ucases', [])]; }
  function casesFor(no) { return allCases().filter((c) => (c.arts || []).includes(no)); }

  /* ------------------------------------------------------------------ *
   * settings
   * ------------------------------------------------------------------ */
  const DEFAULTS = { showAnn: true, fs: 19, font: 'sans', theme: 'auto', pno: 'roman', pencilOnly: true, showNotes: true, showInk: true, xref: true };
  let S = {};
  function loadSettings() { S = Object.assign({}, DEFAULTS, Store.get('settings', {})); applySettings(); }
  function saveSettings() { Store.set('settings', S); applySettings(); }
  function applySettings() {
    const r = document.documentElement;
    r.style.setProperty('--fs', S.fs + 'px');
    r.dataset.font = S.font;
    if (S.theme === 'auto') delete r.dataset.theme; else r.dataset.theme = S.theme;
  }

  /* ------------------------------------------------------------------ *
   * text rendering (cross refs + highlights + search hits)
   * ------------------------------------------------------------------ */
  const CN_D = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function cn2n(s) {
    let n = 0, cur = 0;
    for (const ch of s) {
      if (ch === '百') { n += (cur || 1) * 100; cur = 0; }
      else if (ch === '十') { n += (cur || 1) * 10; cur = 0; }
      else cur = CN_D[ch] ?? 0;
    }
    return n + cur;
  }
  const XREF_RE = /第([〇一二三四五六七八九十百]+)條(?:之([一二三四五六七八九十]+))?/g;
  function xrefs(text, selfNo) {
    const out = [];
    if (!S.xref) return out;
    let m;
    XREF_RE.lastIndex = 0;
    while ((m = XREF_RE.exec(text))) {
      const pre = text.slice(Math.max(0, m.index - 6), m.index);
      if (/(?:條例|規則|細則|辦法|標準|民法|刑法|同法|該法|[^本]法)$/.test(pre)) continue;
      const no = cn2n(m[1]) + (m[2] ? '-' + cn2n(m[2]) : '');
      if (!ART.has(no) || no === selfNo) continue;
      out.push({ s: m.index, e: m.index + m[0].length, no });
    }
    return out;
  }

  function renderLineHTML(text, { hls = [], refs = [], hits = [], anns = [] }) {
    const n = text.length;
    if (!n) return '';
    // anns: [{s, e, c, t, idx, end}] — underline s..e; when end=true, show the note after e
    const und = new Array(n).fill('');
    const ins = new Map();
    anns.forEach((a) => {
      for (let i = Math.max(0, a.s); i < Math.min(n, a.e); i++) und[i] = a.c;
      if (a.end) { const p = Math.min(n, Math.max(0, a.e)); if (!ins.has(p)) ins.set(p, []); ins.get(p).push(a); }
    });
    const annHTML = (p) => (ins.get(p) || []).map((a) => `<span class="ann ann-${a.c}" data-ann="${a.idx}" data-t="${esc(a.t)}" role="button" aria-label="註記：${esc(a.t)}"></span>`).join('');
    const col = new Array(n).fill('');
    hls.forEach((r) => { for (let i = Math.max(0, r.s); i < Math.min(n, r.e); i++) col[i] = r.c; });
    const ref = new Array(n).fill(null);
    refs.forEach((r) => { for (let i = r.s; i < r.e; i++) ref[i] = r; });
    const hit = new Array(n).fill(false);
    hits.forEach((r) => { for (let i = r.s; i < r.e; i++) hit[i] = true; });
    let html = annHTML(0), i = 0;
    while (i < n) {
      let j = i + 1;
      while (j < n && col[j] === col[i] && ref[j] === ref[i] && hit[j] === hit[i] && und[j] === und[i] && !ins.has(j)) j++;
      let seg = esc(text.slice(i, j));
      if (hit[i]) seg = `<mark class="h h-hit">${seg}</mark>`;
      if (col[i]) seg = `<mark class="h h-${col[i]}">${seg}</mark>`;
      if (und[i]) seg = `<span class="annu annu-${und[i]}">${seg}</span>`;
      if (ref[i]) seg = `<a class="xref" data-go="${ref[i].no}">${seg}</a>`;
      html += seg + annHTML(j); i = j;
    }
    return html;
  }

  function findHits(text, q) {
    const out = [];
    if (!q) return out;
    let i = 0;
    const lt = text.toLowerCase(), lq = q.toLowerCase();
    while ((i = lt.indexOf(lq, i)) >= 0) { out.push({ s: i, e: i + q.length }); i += q.length; }
    return out;
  }

  const PNO = {
    roman: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'],
    circle: ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'],
  };

  function lineClass(l) { return l.i >= 6 ? 'sub' : l.i >= 4 ? 'item' : 'para'; }

  function articleBodyHTML(a, hitQ) {
    const hl = Store.get('hl:' + a.no, []);
    const ann = S.showAnn ? Store.get('ann:' + a.no, []) : [];
    const paras = a.lines.filter((l) => l.i === 0).length;
    let p = 0;
    return a.lines.map((l, li) => {
      const cls = lineClass(l);
      let pno = '';
      if (cls === 'para') {
        p++;
        if (paras > 1 && S.pno !== 'none') pno = `<span class="pno" aria-hidden="true">${PNO[S.pno][p - 1] || p}</span>`;
      }
      const inner = renderLineHTML(l.t, { hls: hl.filter((r) => r.l === li), refs: xrefs(l.t, a.no), hits: findHits(l.t, hitQ), anns: annsForLine(ann, li) });
      return `<p class="ln ${cls}${cls === 'para' && (paras <= 1 || S.pno === 'none') ? ' single' : ''}" data-li="${li}">${pno}<span class="lt">${inner}</span></p>`;
    }).join('');
  }

  /* ------------------------------------------------------------------ *
   * article card
   * ------------------------------------------------------------------ */
  const openDetail = new Map(); // no -> tab

  function hasMine(no) {
    return !!(Store.get('note:' + no) || Store.get('hl:' + no) || Store.get('ink:' + no) || Store.get('ann:' + no));
  }

  // inline annotation on the article text: {r:[{l,s,e}], t: text, c: 'r'|'n'|'g'|'v'}
  function annsForLine(list, li) {
    const out = [];
    list.forEach((a, idx) => {
      const last = a.r[a.r.length - 1];
      a.r.forEach((rg) => { if (rg.l === li) out.push({ s: rg.s, e: rg.e, c: a.c, t: a.t, idx, end: rg === last }); });
    });
    return out;
  }
  const ANN_COLORS = [['r', '紅'], ['n', '深藍'], ['g', '綠'], ['v', '紫']];
  function annQuote(no, a) {
    const art = ART.get(no);
    return a.r.map((rg) => (art.lines[rg.l] || { t: '' }).t.slice(rg.s, rg.e)).join('…');
  }
  function editAnn(no, idx, ranges) {
    const list = Store.get('ann:' + no, []).slice();
    const isNew = idx == null;
    const a = isNew ? { r: ranges, t: '', c: Store.get('annColor', 'r') } : { ...list[idx] };
    if (!a || !a.r) return;
    let color = a.c;
    const body = h(`<div>
      <p class="muted" style="margin-top:0">${label(no)}：「${esc(annQuote(no, a))}」</p>
      <div class="field"><label for="annText">註記文字（以小字顯示在這段條文後面）</label><textarea id="annText" style="min-height:90px">${esc(a.t)}</textarea></div>
      <div class="field"><label>顏色</label><span class="seg">${ANN_COLORS.map(([k, t]) => `<button data-c="${k}" class="${k === color ? 'on' : ''}"><span class="ann-dot ann-${k}"></span>${t}</button>`).join('')}</span></div>
    </div>`);
    body.querySelector('.seg').onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c; $$('.seg button', body).forEach((x) => x.classList.toggle('on', x === b)); };
    const btns = [{ text: '取消', fn: () => {} }];
    if (!isNew) btns.push({ text: '刪除', cls: 'danger', fn: () => { list.splice(idx, 1); Store.set('ann:' + no, list); refreshArticle(no); toast('已刪除註記'); } });
    btns.push({ text: '儲存', cls: 'primary', fn: () => {
      const t = $('#annText', body).value.trim();
      if (!t) { toast('請輸入註記文字'); return false; }
      const item = { r: a.r, t, c: color };
      if (isNew) list.push(item); else list[idx] = item;
      list.sort((x, y) => x.r[0].l - y.r[0].l || x.r[0].s - y.r[0].s);
      Store.set('ann:' + no, list);
      Store.set('annColor', color);
      refreshArticle(no);
    } });
    openDialog(isNew ? '在條文上加註' : '編輯條文註記', body, btns);
    setTimeout(() => { const ta = $('#annText', body); if (ta) ta.focus(); }, 60);
  }

  function badgesHTML(a) {
    const ch = ART_CHANGES.get(a.no) || [];
    const b = [];
    if (ch.length) {
      const last = ch[ch.length - 1];
      const isNew = ch[0].c.type === 'add';
      b.push(`<span class="badge clickable ${isNew && ch.length === 1 ? 'b-new' : 'b-amend'}" data-tab="hist">${isNew && ch.length === 1 ? '增訂' : '修正'} ${last.am.roc}</span>`);
    }
    const cs = casesFor(a.no);
    const nJ = cs.filter((c) => c.type === 'J').length, nS = cs.filter((c) => c.type === 'S').length, nA = cs.filter((c) => c.type === 'A').length, nO = cs.filter((c) => c.type === 'O').length;
    if (nJ) b.push(`<span class="badge b-j clickable" data-tab="cases" data-f="J">釋 ${nJ}</span>`);
    if (nS) b.push(`<span class="badge clickable" data-tab="cases" data-f="S">判 ${nS}</span>`);
    if (nA) b.push(`<span class="badge clickable" data-tab="cases" data-f="A">函 ${nA}</span>`);
    if (nO) b.push(`<span class="badge clickable" data-tab="cases" data-f="O">其他 ${nO}</span>`);
    if (a.no === '49') b.push(`<span class="badge b-warn">第1項經釋字807失效</span>`);
    return b.join('');
  }

  function renderArticle(a, opts = {}) {
    const starred = Store.get('stars', []).includes(a.no);
    const el = h(`<article class="art" id="a-${a.no}" data-no="${a.no}">
      <div class="art-head">
        <span class="art-no">${label(a.no)}</span>
        <div class="badges">${badgesHTML(a)}</div>
        <div class="art-tools">
          <button class="icon-btn ${starred ? 'on' : ''}" data-act="star" title="書籤"><svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg></button>
          <button class="icon-btn" data-act="detail" title="註記／判解／沿革"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button>
        </div>
      </div>
      <div class="art-body" data-no="${a.no}">${articleBodyHTML(a, opts.hit)}</div>
    </article>`);
    if (a.no === '49') {
      el.querySelector('.art-body').append(h(`<div class="void-note">司法院釋字第807號解釋（110.08.20）：本條第1項規定違反憲法第7條保障性別平等之意旨，應自解釋公布之日起失其效力。</div>`));
    }
    appendPreviews(el, a.no);
    if (openDetail.has(a.no)) el.append(renderDetail(a.no, openDetail.get(a.no)));
    return el;
  }

  function appendPreviews(el, no) {
    $$('.note-preview, .ink-preview', el).forEach((x) => x.remove());
    const anchor = el.querySelector('.detail');
    const note = Store.get('note:' + no);
    if (S.showNotes && note) {
      const p = h(`<div class="note-preview" data-act="open-note"></div>`);
      p.textContent = note;
      el.insertBefore(p, anchor);
    }
    const ink = Store.get('ink:' + no);
    if (S.showInk && ink && ink.strokes && ink.strokes.length) {
      const p = h(`<div class="ink-preview" data-act="open-ink"><canvas></canvas></div>`);
      el.insertBefore(p, anchor);
      requestAnimationFrame(() => InkPad.renderPreview(p.querySelector('canvas'), ink));
    }
  }

  function refreshArticle(no, keepScroll = true) {
    const old = document.getElementById('a-' + no);
    if (!old) return;
    const a = ART.get(no);
    const main = $('#main');
    const top = old.getBoundingClientRect().top;
    InkPad.disposeIn(old);
    const nu = renderArticle(a);
    old.replaceWith(nu);
    if (keepScroll) main.scrollTop += nu.getBoundingClientRect().top - top;
    updateTocMarks();
  }

  function refreshBadgesAll() {
    $$('#view-law .art').forEach((el) => { el.querySelector('.badges').innerHTML = badgesHTML(ART.get(el.dataset.no)); });
  }

  /* ------------------------------------------------------------------ *
   * detail panel (tabs)
   * ------------------------------------------------------------------ */
  const TABS = [['note', '註記'], ['ink', '手寫'], ['cases', '判解函釋'], ['hist', '沿革對照']];

  function renderDetail(no, tab = 'note', filter) {
    const cs = casesFor(no).length;
    const hv = versionsOf(no).length;
    const d = h(`<div class="detail" data-no="${no}">
      <div class="tabs">${TABS.map(([k, t]) => `<button class="tab ${k === tab ? 'active' : ''}" data-tabk="${k}">${t}${k === 'cases' && cs ? `<span class="n">${cs}</span>` : ''}${k === 'hist' && hv > 1 ? `<span class="n">${hv}版</span>` : ''}</button>`).join('')}</div>
      <div class="panel"></div>
    </div>`);
    fillPanel(d.querySelector('.panel'), no, tab, filter);
    return d;
  }

  function setDetail(no, tab, filter) {
    const el = document.getElementById('a-' + no);
    if (!el) return;
    const cur = el.querySelector('.detail');
    if (cur) { InkPad.disposeIn(cur); cur.remove(); }
    if (tab === null) { openDetail.delete(no); return; }
    openDetail.set(no, tab);
    el.append(renderDetail(no, tab, filter));
  }

  function fillPanel(panel, no, tab, filter) {
    InkPad.disposeIn(panel);
    panel.innerHTML = '';
    if (tab === 'note') panelNote(panel, no);
    else if (tab === 'ink') panelInk(panel, no);
    else if (tab === 'cases') panelCases(panel, no, filter);
    else if (tab === 'hist') panelHist(panel, no);
  }

  function panelNote(panel, no) {
    const ta = h(`<textarea class="note" placeholder="在此輸入你對 ${label(no)} 的註記、心得、考點、實務見解…（自動儲存）"></textarea>`);
    ta.value = Store.get('note:' + no, '');
    const status = h(`<span class="saved"></span>`);
    const save = debounce(() => {
      Store.set('note:' + no, ta.value.trim() ? ta.value : '');
      status.textContent = '已儲存 ' + new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
      const el = document.getElementById('a-' + no);
      if (el) appendPreviews(el, no);
      updateTocMarks();
    }, 500);
    ta.addEventListener('input', save);
    const hl = Store.get('hl:' + no, []);
    panel.append(ta, h(`<div class="row" style="margin-top:8px;justify-content:space-between"></div>`));
    const row = panel.lastChild;
    row.append(status);
    if (hl.length) {
      const b = h(`<button class="btn small">清除本條全部螢光（${hl.length}）</button>`);
      b.onclick = async () => { if (await ask('確定清除本條所有螢光標記？', '清除')) { Store.del('hl:' + no); refreshArticle(no); } };
      row.append(b);
    }
    panel.append(h(`<p class="muted">提示：在條文上長按並選取文字，可加上螢光標記，或按「加註」把小字註記直接寫在該段條文後面（紅、深藍、綠、紫）。點條文上的註記可編輯或刪除。</p>`));
    setTimeout(() => { if (panel.isConnected && !matchMedia('(pointer:coarse)').matches) ta.focus(); }, 50);
  }

  function panelInk(panel, no) {
    InkPad.mount(panel, no);
  }

  function caseCard(c, opts = {}) {
    const mine = c.id.startsWith('u');
    const cnote = Store.get('cnote:' + c.id, '');
    const el = h(`<div class="case" data-id="${esc(c.id)}">
      <div class="case-h">
        <span class="case-type t-${c.type}">${TYPE_NAME[c.type] || '其他'}</span>
        <span class="case-title">${esc(c.title)}</span>
        <span class="case-date">${esc(c.date || '')}</span>
        ${mine ? '<span class="mine">● 自訂</span>' : ''}
      </div>
      ${c.topic ? `<div class="case-topic">${esc(c.topic)}</div>` : ''}
      <div class="case-body ${opts.clamp ? 'clamp' : ''}">${renderLineHTML(c.summary || '', { hits: findHits(c.summary || '', opts.hit) })}</div>
      ${cnote ? `<div class="case-note">✎ ${esc(cnote)}</div>` : ''}
      <div class="case-foot">
        ${opts.showArts ? `<span class="case-arts">${(c.arts || []).map((n) => `<button data-go="${n}">${shortLabel(n)}</button>`).join('')}</span>` : ''}
        ${c.src ? `<span>${esc(c.src)}</span>` : ''}
        ${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">原文 ↗</a>` : ''}
        ${opts.clamp ? `<button class="linkish" data-act="expand">展開全文</button>` : ''}
        <button class="linkish" data-act="cnote">${cnote ? '編輯' : '加'}個人註記</button>
        ${mine ? `<button class="linkish" data-act="edit">編輯</button><button class="linkish" data-act="del" style="color:var(--red)">刪除</button>` : ''}
      </div>
    </div>`);
    return el;
  }

  function panelCases(panel, no, filter) {
    const list = casesFor(no);
    const types = ['J', 'S', 'A', 'O'].filter((t) => list.some((c) => c.type === t));
    let f = filter && types.includes(filter) ? filter : 'all';
    const chips = h(`<div class="chips"></div>`);
    const box = h(`<div></div>`);
    const draw = () => {
      chips.innerHTML = [['all', `全部 ${list.length}`], ...types.map((t) => [t, `${TYPE_NAME[t]} ${list.filter((c) => c.type === t).length}`])]
        .map(([k, t]) => `<button class="chip ${k === f ? 'on' : ''}" data-f="${k}">${t}</button>`).join('');
      box.innerHTML = '';
      const shown = list.filter((c) => f === 'all' || c.type === f).sort(caseSort);
      shown.forEach((c) => box.append(caseCard(c, { clamp: (c.summary || '').length > 260 })));
      if (!shown.length) box.append(h(`<p class="muted">本條尚無收錄的判決、函釋或解釋。你可以按「新增」加入自己整理的資料。</p>`));
    };
    chips.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { f = b.dataset.f; draw(); } });
    const add = h(`<div class="row end" style="margin-bottom:10px"><button class="btn primary">＋ 新增判決／函釋</button></div>`);
    add.querySelector('button').onclick = () => editCase(null, no);
    panel.append(add, chips, box);
    draw();
  }

  function caseSort(a, b) {
    const o = { J: 0, S: 1, A: 2, O: 3 };
    return (o[a.type] - o[b.type]) || String(b.date || '').localeCompare(String(a.date || ''), 'zh-Hant');
  }

  function panelHist(panel, no) {
    const vs = versionsOf(no);
    if (vs.length === 1) {
      panel.append(h(`<p class="muted">${label(no)}自民國 73 年 7 月 30 日制定公布以來未曾修正。</p>`));
      return;
    }
    const tl = h(`<ul class="timeline"></ul>`);
    vs.forEach((v, i) => {
      tl.append(h(`<li><span class="tl-date">${rocDate(v.date)}</span><span class="tl-type badge ${v.kind === '增訂' ? 'b-new' : v.kind === '制定' ? '' : 'b-amend'}">${v.kind}</span><span>${i === vs.length - 1 ? '（現行）' : ''}</span></li>`));
    });
    panel.append(h(`<h4>條文沿革</h4>`), tl);

    const ctrl = h(`<div class="cmp-ctrl" style="margin-top:14px"><b>新舊條文對照</b>
      <select data-k="b"></select><span>對照</span><select data-k="a"></select></div>`);
    const opt = (sel, idx) => vs.map((v, i) => `<option value="${i}" ${i === idx ? 'selected' : ''}>${rocDate(v.date)} ${v.kind}${i === vs.length - 1 ? '（現行）' : ''}</option>`).join('');
    const sb = ctrl.querySelector('[data-k=b]'), sa = ctrl.querySelector('[data-k=a]');
    sb.innerHTML = opt(sb, vs.length - 1);
    sa.innerHTML = opt(sa, vs.length - 2);
    const out = h(`<div></div>`);
    const draw = () => {
      const nb = vs[+sb.value], na = vs[+sa.value];
      out.innerHTML = '';
      out.append(compareTable(na.lines, nb.lines, `${rocDate(nb.date)} ${nb.kind}`, `${rocDate(na.date)} ${na.kind}`));
    };
    sb.onchange = sa.onchange = draw;
    panel.append(ctrl, h(`<div class="legend"><ins class="d">新增文字</ins>　<del class="d">刪除文字</del>　左欄為較新版本（修正條文），右欄為比較版本（原條文）</div>`), out);
    draw();
  }

  /* ------------------------------------------------------------------ *
   * diff
   * ------------------------------------------------------------------ */
  function diffChars(a, b) {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const A = a.slice(p, a.length - s), B = b.slice(p, b.length - s);
    const n = A.length, m = B.length;
    const ops = [];
    if (p) ops.push([0, a.slice(0, p)]);
    if (n === 0 && m) ops.push([1, B]);
    else if (m === 0 && n) ops.push([-1, A]);
    else if (n && m) {
      if (n * m > 4e6) { ops.push([-1, A], [1, B]); }
      else {
        const W = m + 1;
        const dp = new Uint16Array((n + 1) * W);
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
          dp[i * W + j] = A[i] === B[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
        let i = 0, j = 0;
        const push = (t, c) => { const l = ops[ops.length - 1]; if (l && l[0] === t) l[1] += c; else ops.push([t, c]); };
        while (i < n && j < m) {
          if (A[i] === B[j]) { push(0, A[i]); i++; j++; }
          else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { push(-1, A[i]); i++; }
          else { push(1, B[j]); j++; }
        }
        while (i < n) push(-1, A[i++]);
        while (j < m) push(1, B[j++]);
      }
    }
    if (s) ops.push([0, a.slice(a.length - s)]);
    return cleanup(ops);
  }
  // merge tiny equal islands (≤2 chars) between edits for readability
  function cleanup(ops) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 1; i < ops.length - 1; i++) {
        if (ops[i][0] === 0 && ops[i][1].length <= 2 && !ops[i][1].includes('\n') && ops[i - 1][0] !== 0 && ops[i + 1][0] !== 0) {
          const eq = ops[i][1];
          const seq = ops.splice(i - 1, 3);
          let del = '', ins = '';
          seq.forEach(([t, c]) => { if (t <= 0) del += c; if (t >= 0) ins += c; });
          const rep = [];
          if (del) rep.push([-1, del]);
          if (ins) rep.push([1, ins]);
          ops.splice(i - 1, 0, ...rep);
          changed = true;
          break;
        }
      }
      // normalise: combine adjacent same-type and order del before ins
      const norm = [];
      for (const o of ops) {
        const l = norm[norm.length - 1];
        if (l && l[0] === o[0]) l[1] += o[1];
        else norm.push([o[0], o[1]]);
      }
      const n2 = [];
      for (let i = 0; i < norm.length; i++) {
        if (norm[i][0] === 1 && norm[i + 1] && norm[i + 1][0] === -1) { n2.push(norm[i + 1], norm[i]); i++; changed = changed || false; }
        else n2.push(norm[i]);
      }
      ops = n2;
      // merge consecutive del/ins pairs: [-1,a][1,b][-1,c][1,d] -> [-1,a+c][1,b+d]
      for (let i = 0; i + 3 < ops.length; i++) {
        if (ops[i][0] === -1 && ops[i + 1][0] === 1 && ops[i + 2][0] === -1 && ops[i + 3][0] === 1) {
          ops.splice(i, 4, [-1, ops[i][1] + ops[i + 2][1]], [1, ops[i + 1][1] + ops[i + 3][1]]);
          changed = true;
          break;
        }
      }
    }
    return ops;
  }

  function sideLines(ops, keep, tag) {
    const lines = [[]];
    ops.forEach(([t, c]) => {
      if (t !== 0 && t !== keep) return;
      c.split('\n').forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1].push([t, part]);
      });
    });
    return lines.map((segs) => segs.map(([t, c]) => (t === 0 ? esc(c) : `<${tag} class="d">${esc(c)}</${tag}>`)).join(''));
  }

  function compareTable(oldLines, newLines, newTitle, oldTitle) {
    const a = oldLines.map((l) => l.t).join('\n');
    const b = newLines.map((l) => l.t).join('\n');
    const ops = diffChars(a, b);
    const L = (arr, src) => (src.length ? arr.map((x, i) => `<p class="${src[i] ? lineClass(src[i]) : ''}">${x || '&nbsp;'}</p>`).join('') : `<p class="cmp-empty">（無）</p>`);
    return h(`<div class="cmp">
      <div class="cmp-h cmp-new">${esc(newTitle)}</div><div class="cmp-h">${esc(oldTitle)}</div>
      <div class="cmp-new">${L(sideLines(ops, 1, 'ins'), newLines)}</div>
      <div>${L(sideLines(ops, -1, 'del'), oldLines)}</div>
    </div>`);
  }

  /* ------------------------------------------------------------------ *
   * handwriting pad (Apple Pencil friendly)
   * ------------------------------------------------------------------ */
  const InkPad = (() => {
    const LW = 1000; // logical width
    const COLORS = ['#1f2328', '#c0392b', '#1f5fbf', '#1e7f4f', '#b26a00'];
    const pads = new Set();
    let tool = { kind: 'pen', color: COLORS[0], size: 3 };

    function drawStroke(ctx, st, k) {
      const p = st.p;
      if (!p.length) return;
      ctx.save();
      ctx.strokeStyle = st.c; ctx.fillStyle = st.c;
      ctx.globalAlpha = st.a || 1;
      ctx.lineCap = st.a && st.a < 1 ? 'butt' : 'round';
      ctx.lineJoin = 'round';
      if (st.a && st.a < 1) ctx.globalCompositeOperation = 'multiply';
      if (p.length <= 3) {
        ctx.beginPath(); ctx.arc(p[0] * k, p[1] * k, (st.w * k) / 2, 0, Math.PI * 2); ctx.fill();
      } else if (st.a && st.a < 1) {
        ctx.lineWidth = st.w * k;
        ctx.beginPath(); ctx.moveTo(p[0] * k, p[1] * k);
        for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i] * k, p[i + 1] * k);
        ctx.stroke();
      } else {
        for (let i = 3; i < p.length; i += 3) {
          const pr = (p[i + 2] + p[i - 1]) / 2 || 0.5;
          ctx.lineWidth = Math.max(0.6, st.w * k * (0.45 + pr * 1.1));
          ctx.beginPath(); ctx.moveTo(p[i - 3] * k, p[i - 2] * k); ctx.lineTo(p[i] * k, p[i + 1] * k); ctx.stroke();
        }
      }
      ctx.restore();
    }

    function renderTo(canvas, data, cssW) {
      const dpr = window.devicePixelRatio || 1;
      const k = cssW / LW;
      const cssH = data.h * k;
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      canvas.style.height = cssH + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      data.strokes.forEach((s) => drawStroke(ctx, s, k));
      return { ctx, k };
    }

    function renderPreview(canvas, data) {
      const w = canvas.parentElement.clientWidth || 600;
      // crop to used height
      let maxY = 0;
      data.strokes.forEach((s) => { for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i] + s.w); });
      renderTo(canvas, { h: Math.min(data.h, maxY + 20), strokes: data.strokes }, w);
    }

    function mount(panel, no) {
      const data = JSON.parse(JSON.stringify(Store.get('ink:' + no, { h: 520, strokes: [] })));
      const hist = [];
      const ui = h(`<div>
        <div class="ink-tools">
          ${COLORS.map((c) => `<button class="pen" data-color="${c}" style="background:${c}" aria-label="筆色"></button>`).join('')}
          <span class="seg"><button data-size="2">細</button><button data-size="3">中</button><button data-size="6">粗</button></span>
          <button class="btn small tool" data-kind="hl">螢光筆</button>
          <button class="btn small tool" data-kind="eraser">橡皮擦</button>
          <button class="btn small tool" data-act="undo">復原</button>
          <button class="btn small tool" data-act="more">加長</button>
          <button class="btn small tool danger" data-act="clear">清空</button>
          <button class="btn small tool" data-act="write">✍︎ 書寫模式</button>
        </div>
        <div class="ink-wrap"><canvas></canvas><span class="ink-hint"></span></div>
        <p class="muted">${S.pencilOnly ? '目前設定「僅 Apple Pencil 書寫」：手指可捲動頁面，Pencil 直接書寫。' : '書寫模式開啟時，手指與 Pencil 都能書寫；關閉書寫模式即可用手指捲動。'}（可於設定切換）</p>
      </div>`);
      panel.append(ui);
      const wrap = $('.ink-wrap', ui), canvas = $('canvas', ui), hint = $('.ink-hint', ui);
      let writing = S.pencilOnly ? true : false;
      let ctx, k, cur = null, cssW = 0;

      const syncTools = () => {
        $$('.pen', ui).forEach((b) => b.classList.toggle('on', tool.kind !== 'eraser' && b.dataset.color === tool.color));
        $$('[data-size]', ui).forEach((b) => b.classList.toggle('on', +b.dataset.size === tool.size));
        $$('[data-kind]', ui).forEach((b) => b.classList.toggle('on', b.dataset.kind === tool.kind));
        const wb = $('[data-act=write]', ui);
        wb.classList.toggle('on', writing);
        wb.style.display = S.pencilOnly ? 'none' : '';
        wrap.classList.toggle('writing', writing && !S.pencilOnly);
        hint.textContent = S.pencilOnly ? 'Apple Pencil 書寫' : writing ? '書寫中' : '書寫模式關閉';
      };
      const redraw = () => {
        cssW = wrap.clientWidth;
        if (!cssW) return;
        ({ ctx, k } = renderTo(canvas, data, cssW));
      };
      const save = debounce(() => {
        Store.set('ink:' + no, data.strokes.length ? data : null);
        const el = document.getElementById('a-' + no);
        if (el) appendPreviews(el, no);
        updateTocMarks();
      }, 400);
      const snap = () => { hist.push(JSON.stringify(data.strokes)); if (hist.length > 40) hist.shift(); };
      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) / k, (e.clientY - r.top) / k, e.pressure || 0.5];
      };
      const accept = (e) => {
        if (S.pencilOnly) return e.pointerType === 'pen' || e.pointerType === 'mouse';
        return writing;
      };
      const eraseAt = (x, y) => {
        const r = 14;
        const before = data.strokes.length;
        data.strokes = data.strokes.filter((s) => {
          for (let i = 0; i < s.p.length; i += 3) if (Math.hypot(s.p[i] - x, s.p[i + 1] - y) < r + s.w) return false;
          return true;
        });
        if (data.strokes.length !== before) redraw();
      };

      canvas.addEventListener('pointerdown', (e) => {
        if (!accept(e)) return;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        snap();
        const [x, y, p] = pos(e);
        if (tool.kind === 'eraser') { cur = { erase: true }; eraseAt(x, y); return; }
        cur = tool.kind === 'hl' ? { c: tool.color === COLORS[0] ? '#ffd400' : tool.color, w: 18, a: 0.35, p: [x, y, p] } : { c: tool.color, w: tool.size, p: [x, y, p] };
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!cur) return;
        e.preventDefault();
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of evs) {
          const [x, y, p] = pos(ev);
          if (cur.erase) { eraseAt(x, y); continue; }
          cur.p.push(x, y, p);
          if (!cur.a) drawStroke(ctx, { c: cur.c, w: cur.w, p: cur.p.slice(-6) }, k);
        }
        if (cur.a) { redraw(); drawStroke(ctx, cur, k); }
      });
      const end = () => {
        if (!cur) return;
        if (!cur.erase) {
          cur.p = cur.p.map((v, i) => (i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10));
          data.strokes.push(cur);
          if (cur.a) redraw();
        }
        cur = null;
        save();
      };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
      // Pencil-only: block scrolling only for stylus touches (Safari exposes touchType)
      const blockStylus = (e) => { if (S.pencilOnly && [...e.touches].some((t) => t.touchType === 'stylus')) e.preventDefault(); };
      canvas.addEventListener('touchstart', blockStylus, { passive: false });
      canvas.addEventListener('touchmove', blockStylus, { passive: false });

      ui.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.color) { tool.color = b.dataset.color; if (tool.kind === 'eraser') tool.kind = 'pen'; }
        if (b.dataset.size) { tool.size = +b.dataset.size; if (tool.kind !== 'pen') tool.kind = 'pen'; }
        if (b.dataset.kind) tool.kind = tool.kind === b.dataset.kind ? 'pen' : b.dataset.kind;
        const act = b.dataset.act;
        if (act === 'undo' && hist.length) { data.strokes = JSON.parse(hist.pop()); redraw(); save(); }
        if (act === 'more') { data.h += 300; redraw(); save(); }
        if (act === 'clear' && data.strokes.length) ask('清空本條所有手寫內容？', '清空').then((ok) => { if (ok) { snap(); data.strokes = []; data.h = 520; redraw(); save(); } });
        if (act === 'write') writing = !writing;
        syncTools();
      });

      const ro = new ResizeObserver(() => { if (Math.abs(wrap.clientWidth - cssW) > 1) redraw(); });
      ro.observe(wrap);
      const pad = { panel, dispose: () => ro.disconnect() };
      pads.add(pad);
      syncTools();
      requestAnimationFrame(redraw);
    }

    function disposeIn(el) {
      for (const p of [...pads]) if (el.contains(p.panel) || p.panel === el) { p.dispose(); pads.delete(p); }
    }
    return { mount, disposeIn, renderPreview };
  })();

  /* ------------------------------------------------------------------ *
   * highlight via text selection
   * ------------------------------------------------------------------ */
  const hlbar = $('#hlbar');
  let selInfo = null;

  function offsetIn(lineEl, node, off) {
    const lt = lineEl.querySelector('.lt');
    const r = document.createRange();
    r.setStart(lt, 0);
    try { r.setEnd(node, off); } catch (e) { return 0; }
    return r.toString().length;
  }

  function readSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const rg = sel.getRangeAt(0);
    const body = (rg.commonAncestorContainer.nodeType === 1 ? rg.commonAncestorContainer : rg.commonAncestorContainer.parentElement).closest('.art-body');
    if (!body) return null;
    const no = body.dataset.no;
    const lines = $$('.ln', body);
    const ranges = [];
    lines.forEach((ln) => {
      const lt = ln.querySelector('.lt');
      if (!rg.intersectsNode(lt)) return;
      const len = lt.textContent.length;
      let s = 0, e = len;
      if (lt.contains(rg.startContainer)) s = offsetIn(ln, rg.startContainer, rg.startOffset);
      if (lt.contains(rg.endContainer)) e = offsetIn(ln, rg.endContainer, rg.endOffset);
      if (e > s) ranges.push({ l: +ln.dataset.li, s, e });
    });
    if (!ranges.length) return null;
    return { no, ranges, text: sel.toString(), rect: rg.getBoundingClientRect() };
  }

  const onSel = debounce(() => {
    selInfo = readSelection();
    if (!selInfo) { hlbar.hidden = true; return; }
    hlbar.hidden = false;
    const r = selInfo.rect, bw = hlbar.offsetWidth, bh = hlbar.offsetHeight;
    let top = r.bottom + 12;
    if (top + bh > window.innerHeight - 10) top = r.top - bh - 12;
    hlbar.style.top = Math.max(70, top) + 'px';
    hlbar.style.left = Math.min(window.innerWidth - bw - 8, Math.max(8, r.left + r.width / 2 - bw / 2)) + 'px';
  }, 180);
  document.addEventListener('selectionchange', onSel);

  function applyHighlight(no, ranges, c) {
    let hl = Store.get('hl:' + no, []).slice();
    ranges.forEach((nr) => {
      const next = [];
      hl.forEach((r) => {
        if (r.l !== nr.l || r.e <= nr.s || r.s >= nr.e) { next.push(r); return; }
        if (r.s < nr.s) next.push({ ...r, e: nr.s });
        if (r.e > nr.e) next.push({ ...r, s: nr.e });
      });
      if (c !== 'x') next.push({ l: nr.l, s: nr.s, e: nr.e, c });
      hl = next;
    });
    hl.sort((a, b) => a.l - b.l || a.s - b.s);
    Store.set('hl:' + no, hl);
    refreshArticle(no);
  }

  hlbar.addEventListener('pointerdown', (e) => e.preventDefault()); // keep selection
  hlbar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !selInfo) return;
    const { no, ranges, text } = selInfo;
    if (b.dataset.c) applyHighlight(no, ranges, b.dataset.c);
    if (b.dataset.act === 'note') { void text; editAnn(no, null, ranges); }
    window.getSelection().removeAllRanges();
    hlbar.hidden = true;
  });

  /* ------------------------------------------------------------------ *
   * views
   * ------------------------------------------------------------------ */
  let curView = 'law';
  function showView(v, push = true) {
    curView = v;
    $$('.view').forEach((x) => x.classList.toggle('active', x.id === 'view-' + v));
    $$('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    if (v === 'amend') renderAmend();
    if (v === 'cases') renderCasesView();
    if (v === 'mine') renderMine();
    if (v !== 'law' && v !== 'search') $('#main').scrollTop = 0;
    if (push && v !== 'search') history.replaceState(null, '', v === 'law' ? location.pathname + location.search : '#' + v);
    document.body.classList.remove('toc-open');
  }

  function renderLaw() {
    const v = $('#view-law');
    v.innerHTML = '';
    v.append(h(`<div class="law-head"><h1>勞動基準法</h1>
      <div class="meta">現行法　民國 ${D.meta.modifiedRoc.replace(/\./g, ' 年 ').replace(/ 年 (\d+)$/, ' 月 $1 日')}修正公布｜全 ${ARTS.length} 條｜資料來源：<a href="${D.meta.source}" target="_blank" rel="noopener">全國法規資料庫</a></div></div>`));
    let ch = null;
    const frag = document.createDocumentFragment();
    ARTS.forEach((a) => {
      if (a.ch !== ch) { ch = a.ch; frag.append(h(`<div class="chapter-title" id="ch-${esc(ch)}">${esc(chName(ch))}</div>`)); }
      frag.append(renderArticle(a));
    });
    v.append(frag);
    v.append(h(`<div class="disclaimer">條文、歷次修正條文與大法官解釋取自法務部全國法規資料庫；判決要旨係摘錄自司法院裁判書系統中法院引用之文字，函釋則為法院判決中引用之主管機關函號與內容摘錄，僅供學習參考，實際引用請以原文為準。個人註記僅儲存在本裝置，請定期於「設定」匯出備份。</div>`));
    observeArticles();
  }

  function renderToc() {
    const toc = $('#toc');
    const groups = [];
    ARTS.forEach((a) => { if (!groups.length || groups[groups.length - 1].ch !== a.ch) groups.push({ ch: a.ch, arts: [] }); groups[groups.length - 1].arts.push(a); });
    const openSet = new Set(Store.get('tocOpen', groups.map((g) => g.ch)));
    toc.innerHTML = groups.map((g) => `<details ${openSet.has(g.ch) ? 'open' : ''} data-ch="${esc(g.ch)}"><summary><span>${esc(chName(g.ch))}</span><span class="cnt">${g.arts.length} 條</span></summary>
      <div class="arts">${g.arts.map((a) => `<button data-go="${a.no}" id="t-${a.no}">${shortLabel(a.no)}</button>`).join('')}</div></details>`).join('');
    toc.addEventListener('toggle', () => Store.set('tocOpen', $$('details[open]', toc).map((d) => d.dataset.ch)), true);
    updateTocMarks();
  }
  function updateTocMarks() {
    const stars = new Set(Store.get('stars', []));
    ARTS.forEach((a) => {
      const b = document.getElementById('t-' + a.no);
      if (!b) return;
      b.innerHTML = `${shortLabel(a.no)}${hasMine(a.no) ? '<span class="dot"></span>' : ''}${stars.has(a.no) ? '<span class="star">★</span>' : ''}`;
    });
  }

  let io;
  function observeArticles() {
    if (io) io.disconnect();
    const vis = new Map();
    io = new IntersectionObserver((ents) => {
      ents.forEach((e) => (e.isIntersecting ? vis.set(e.target.dataset.no, e.boundingClientRect.top) : vis.delete(e.target.dataset.no)));
      if (!vis.size || curView !== 'law') return;
      const top = [...vis.keys()].sort((a, b) => ORDER.get(a) - ORDER.get(b))[0];
      $$('.toc .arts button.cur').forEach((b) => b.classList.remove('cur'));
      const tb = document.getElementById('t-' + top);
      if (tb) tb.classList.add('cur');
      saveLast(top);
    }, { root: $('#main'), rootMargin: '-10% 0px -70% 0px' });
    $$('#view-law .art').forEach((el) => io.observe(el));
  }
  const saveLast = debounce((no) => Store.set('last', no), 800);

  function goArticle(no, opts = {}) {
    if (!ART.has(no)) { toast(`找不到${label(no)}`); return; }
    if (curView !== 'law') showView('law');
    const el = document.getElementById('a-' + no);
    if (!el) return;
    if (opts.hit) {
      const nu = renderArticle(ART.get(no), { hit: opts.hit });
      el.replaceWith(nu);
      setTimeout(() => refreshArticle(no), 6000);
    }
    const target = document.getElementById('a-' + no);
    target.scrollIntoView({ block: 'start', behavior: opts.smooth ? 'smooth' : 'auto' });
    target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
    if (opts.tab) setDetail(no, opts.tab, opts.filter);
    document.body.classList.remove('toc-open');
  }

  /* ---------- amendments view ---------- */
  function renderAmend() {
    const v = $('#view-amend');
    if (v.dataset.done) return;
    v.dataset.done = 1;
    v.innerHTML = `<div class="page-h"><h2>修法沿革與新舊條文對照</h2><span class="muted">共 ${D.amendments.length} 次公布，點選展開對照表</span></div>
      <div class="legend"><ins class="d">新增文字</ins>　<del class="d">刪除文字</del>　左欄為修正後條文，右欄為修正前條文</div>`;
    [...D.amendments].reverse().forEach((am, idx) => {
      const arts = am.changes.map((c) => `${shortLabel(c.no)}${c.type === 'add' ? '（增）' : c.type === 'del' ? '（刪）' : ''}`).join('、');
      const d = h(`<details class="amend" ${idx === 0 ? 'open' : ''}><summary><span class="a-date">${am.roc}</span><span class="a-arts">${am.changes.length ? '第 ' + arts + ' 條' : '制定公布全文 86 條'}</span></summary><div class="a-body"><div class="a-desc">${esc(am.desc)}</div></div></details>`);
      const body = d.querySelector('.a-body');
      const fill = () => {
        if (body.dataset.done) return;
        body.dataset.done = 1;
        am.changes.forEach((c) => {
          const t = h(`<div class="a-art"><span>${label(c.no)}</span><span class="badge ${c.type === 'add' ? 'b-new' : 'b-amend'}">${c.type === 'add' ? '增訂' : c.type === 'del' ? '刪除' : '修正'}</span><button class="btn small" data-go="${c.no}">看現行條文</button></div>`);
          body.append(t, compareTable(c.old, c.new, `修正條文（${am.roc}）`, c.type === 'add' ? '原條文（無）' : '修正前條文'));
        });
        if (!am.changes.length) body.append(h(`<p class="muted">民國 73 年 7 月 30 日制定公布全文 86 條，同年 8 月 1 日施行。</p>`));
      };
      if (idx === 0) fill();
      d.addEventListener('toggle', () => d.open && fill());
      v.append(d);
    });
  }

  /* ---------- cases view ---------- */
  let cvFilter = 'all', cvQuery = '';
  function renderCasesView() {
    const v = $('#view-cases');
    const list = allCases();
    v.innerHTML = `<div class="page-h"><h2>判解函釋</h2><span class="muted">大法官解釋 ${list.filter((c) => c.type === 'J').length}・判決 ${list.filter((c) => c.type === 'S').length}・函釋 ${list.filter((c) => c.type === 'A').length}${list.some((c) => c.type === 'O') ? '・其他 ' + list.filter((c) => c.type === 'O').length : ''}</span>
      <button class="btn primary" style="margin-left:auto" data-act="add">＋ 新增</button></div>
      <div class="chips">${[['all', '全部'], ['J', '大法官解釋'], ['S', '判決'], ['A', '函釋'], ['O', '其他'], ['u', '我新增的']].map(([k, t]) => `<button class="chip ${k === cvFilter ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
      <div class="field"><input type="search" placeholder="在判解函釋中搜尋（字號、要旨、條號）" value="${esc(cvQuery)}"></div>
      <div class="cv-list"></div>`;
    const box = $('.cv-list', v);
    const draw = () => {
      box.innerHTML = '';
      const q = cvQuery.trim();
      const shown = list.filter((c) => (cvFilter === 'all' || c.type === cvFilter || (cvFilter === 'u' && c.id.startsWith('u'))) &&
        (!q || [c.title, c.summary, c.topic, c.date, ...(c.arts || []).map(label)].join(' ').includes(q)))
        .sort((a, b) => (ORDER.get((a.arts || [])[0]) ?? 999) - (ORDER.get((b.arts || [])[0]) ?? 999) || caseSort(a, b));
      shown.forEach((c) => box.append(caseCard(c, { showArts: true, clamp: (c.summary || '').length > 220, hit: q })));
      if (!shown.length) box.append(h(`<div class="empty">沒有符合的資料</div>`));
    };
    v.querySelector('.chips').onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; cvFilter = b.dataset.f; $$('.chip', v).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
    v.querySelector('input').oninput = (e) => { cvQuery = e.target.value; draw(); };
    v.querySelector('[data-act=add]').onclick = () => editCase(null, null);
    draw();
  }

  /* ---------- my notes view ---------- */
  function renderMine() {
    const v = $('#view-mine');
    const stars = Store.get('stars', []);
    const noted = ARTS.filter((a) => hasMine(a.no));
    const ucases = Store.get('ucases', []);
    v.innerHTML = `<div class="page-h"><h2>我的筆記</h2><span class="muted">書籤 ${stars.length}・有註記的條文 ${noted.length}・自訂判解 ${ucases.length}</span></div>`;
    const sec = (t) => v.appendChild(h(`<h3 style="margin:18px 0 8px;font-size:16px;color:var(--ink-2)">${t}</h3>`));
    sec('★ 書籤');
    if (!stars.length) v.append(h(`<p class="muted">點條文右上角的星號即可加入書籤。</p>`));
    sortNos(stars).forEach((no) => v.append(resultItem(no, ART.get(no) ? artText(ART.get(no)).slice(0, 90) + '…' : '')));
    sec('✎ 註記、螢光與手寫');
    if (!noted.length) v.append(h(`<p class="muted">尚無註記。展開任一條文的「註記」或「手寫」分頁開始做筆記。</p>`));
    noted.forEach((a) => {
      const hl = Store.get('hl:' + a.no, []);
      const parts = [];
      if (Store.get('note:' + a.no)) parts.push(esc(Store.get('note:' + a.no)).slice(0, 160));
      if (hl.length) parts.push(`<span class="muted">螢光 ${hl.length} 處：</span>` + hl.slice(0, 3).map((r) => `<mark class="h h-${r.c}">${esc((a.lines[r.l] || { t: '' }).t.slice(r.s, r.e))}</mark>`).join('　'));
      const anns = Store.get('ann:' + a.no, []);
      if (anns.length) parts.push(`<span class="muted">條文註記 ${anns.length} 則：</span>` + anns.slice(0, 4).map((x) => `「${esc(annQuote(a.no, x))}」<span class="ann-inline ann-${x.c}">${esc(x.t)}</span>`).join('　'));
      if (Store.get('ink:' + a.no)) parts.push('<span class="muted">✍︎ 含手寫筆記</span>');
      v.append(resultItem(a.no, parts.join('<br>'), true));
    });
    sec('自訂判決／函釋');
    if (!ucases.length) v.append(h(`<p class="muted">在任一條文的「判解函釋」分頁或「判解函釋」頁面按「新增」。</p>`));
    ucases.forEach((c) => v.append(caseCard(c, { showArts: true })));
  }
  function resultItem(no, html, raw) {
    const el = h(`<div class="result" data-go="${no}"><div class="r-h">${label(no)}　${esc(chName(ART.get(no)?.ch))}</div><div class="r-t">${raw ? html : esc(html)}</div></div>`);
    return el;
  }

  /* ---------- search ---------- */
  function parseArtNo(q) {
    const m = q.replace(/\s/g, '').match(/^(?:第)?([0-9０-９]+)(?:條)?(?:(?:之|-|－)([0-9０-９]+))?(?:條)?$/);
    if (!m) return null;
    const z = (s) => String(+s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
    const no = z(m[1]) + (m[2] ? '-' + z(m[2]) : '');
    return ART.has(no) ? no : null;
  }
  let lastView = 'law';
  function doSearch(q) {
    q = q.trim();
    const v = $('#view-search');
    if (!q) { if (curView === 'search') showView(lastView); return; }
    if (curView !== 'search') lastView = curView;
    showView('search', false);
    $('#main').scrollTop = 0;
    const no = parseArtNo(q);
    const snip = (t, i, n = 40) => {
      const s = Math.max(0, i - n), e = Math.min(t.length, i + q.length + n);
      return (s ? '…' : '') + renderLineHTML(t.slice(s, e), { hits: findHits(t.slice(s, e), q) }) + (e < t.length ? '…' : '');
    };
    const ra = [], rn = [], rc = [];
    ARTS.forEach((a) => {
      const t = artText(a);
      const i = t.toLowerCase().indexOf(q.toLowerCase());
      if (i >= 0) ra.push({ no: a.no, html: snip(t, i), n: findHits(t, q).length });
      const note = [Store.get('note:' + a.no, ''), ...Store.get('ann:' + a.no, []).map((x) => x.t)].filter(Boolean).join('　');
      const j = note.toLowerCase().indexOf(q.toLowerCase());
      if (j >= 0) rn.push({ no: a.no, html: snip(note, j) });
    });
    allCases().forEach((c) => {
      const t = [c.title, c.topic, c.summary, Store.get('cnote:' + c.id, '')].join('　');
      const i = t.toLowerCase().indexOf(q.toLowerCase());
      if (i >= 0) rc.push({ c, html: snip(t, i, 50) });
    });
    v.innerHTML = `<div class="page-h"><h2>搜尋「${esc(q)}」</h2><span class="muted">條文 ${ra.length}・註記 ${rn.length}・判解函釋 ${rc.length}</span></div>`;
    if (no) v.append(h(`<div class="result" data-go="${no}" style="border-color:var(--accent-2)"><div class="r-h">跳至條號</div><div class="r-t"><b>${label(no)}</b>　${esc(artText(ART.get(no)).slice(0, 60))}…</div></div>`));
    const sec = (t) => v.appendChild(h(`<h3 style="margin:16px 0 8px;font-size:15px;color:var(--ink-2)">${t}</h3>`));
    if (ra.length) { sec('條文'); ra.forEach((r) => { const el = h(`<div class="result" data-go="${r.no}" data-hit="${esc(q)}"><div class="r-h">${label(r.no)}${r.n > 1 ? `（${r.n} 處）` : ''}</div><div class="r-t">${r.html}</div></div>`); v.append(el); }); }
    if (rn.length) { sec('我的註記'); rn.forEach((r) => v.append(h(`<div class="result" data-go="${r.no}" data-tab="note"><div class="r-h">${label(r.no)}・註記</div><div class="r-t">${r.html}</div></div>`))); }
    if (rc.length) { sec('判解函釋'); rc.forEach((r) => v.append(h(`<div class="result" data-go="${(r.c.arts || [])[0] || ''}" data-tab="cases"><div class="r-h">${TYPE_NAME[r.c.type]}・${esc(r.c.title)}　${(r.c.arts || []).map(label).join('、')}</div><div class="r-t">${r.html}</div></div>`))); }
    if (!ra.length && !rn.length && !rc.length && !no) v.append(h(`<div class="empty">找不到「${esc(q)}」</div>`));
  }

  /* ------------------------------------------------------------------ *
   * dialogs
   * ------------------------------------------------------------------ */
  const dlg = $('#dlg');
  function openDialog(title, bodyEl, buttons) {
    dlg.innerHTML = '';
    const head = h(`<div class="dlg-h"><span>${esc(title)}</span><button class="icon-btn" aria-label="關閉"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`);
    head.querySelector('button').onclick = () => dlg.close();
    const b = h(`<div class="dlg-b"></div>`); b.append(bodyEl);
    const f = h(`<div class="dlg-f"></div>`);
    (buttons || []).forEach((bt) => { const x = h(`<button class="btn ${bt.cls || ''}">${esc(bt.text)}</button>`); x.onclick = () => { if (bt.fn() !== false) dlg.close(); }; f.append(x); });
    dlg.append(head, b);
    if (buttons && buttons.length) dlg.append(f);
    dlg.showModal();
  }

  function editCase(id, no) {
    const list = Store.get('ucases', []);
    const c = id ? list.find((x) => x.id === id) : { type: 'S', title: '', date: '', topic: '', summary: '', arts: no ? [no] : [], url: '' };
    const body = h(`<div>
      <div class="field"><label>類型</label><select name="type">${['S', 'A', 'J', 'O'].map((t) => `<option value="${t}" ${c.type === t ? 'selected' : ''}>${TYPE_NAME[t]}</option>`).join('')}</select></div>
      <div class="field"><label>字號 / 名稱</label><input name="title" placeholder="例：最高法院 110 年度台上字第 123 號判決、勞動部 ○○ 函" value="${esc(c.title)}"></div>
      <div class="field"><label>日期</label><input name="date" placeholder="例：民國 110 年 5 月 12 日" value="${esc(c.date)}"></div>
      <div class="field"><label>爭點 / 主題</label><input name="topic" value="${esc(c.topic)}"></div>
      <div class="field"><label>要旨 / 內容</label><textarea name="summary">${esc(c.summary)}</textarea></div>
      <div class="field"><label>相關條號（以逗號分隔，例如 24, 32-1, 9之1）</label><input name="arts" value="${esc((c.arts || []).map(shortLabel).join(', '))}"></div>
      <div class="field"><label>原文連結（選填）</label><input name="url" type="url" value="${esc(c.url)}"></div>
    </div>`);
    openDialog(id ? '編輯判決／函釋' : '新增判決／函釋', body, [
      { text: '取消', fn: () => {} },
      {
        text: '儲存', cls: 'primary', fn: () => {
          const g = (n) => body.querySelector(`[name=${n}]`).value.trim();
          const arts = g('arts').split(/[,，、\s]+/).map((x) => parseArtNo(x)).filter(Boolean);
          if (!g('title')) { toast('請輸入字號或名稱'); return false; }
          if (!arts.length) { toast('請至少輸入一個正確的條號'); return false; }
          const item = { id: id || 'u' + Date.now().toString(36), type: g('type'), title: g('title'), date: g('date'), topic: g('topic'), summary: g('summary'), arts: sortNos(arts), url: g('url'), src: '自訂' };
          const nl = id ? list.map((x) => (x.id === id ? item : x)) : [...list, item];
          Store.set('ucases', nl);
          afterCaseChange(item.arts.concat(c.arts || []));
          toast('已儲存');
        },
      },
    ]);
  }

  function afterCaseChange(nos) {
    refreshBadgesAll();
    sortNos(nos).forEach((no) => { if (openDetail.get(no) === 'cases') setDetail(no, 'cases'); });
    if (curView === 'cases') renderCasesView();
    if (curView === 'mine') renderMine();
  }

  function editCaseNote(id) {
    const c = allCases().find((x) => x.id === id);
    const body = h(`<div><p class="muted" style="margin-top:0">${esc(c.title)}</p><div class="field"><textarea name="n" placeholder="你對這則判決／函釋的筆記">${esc(Store.get('cnote:' + id, ''))}</textarea></div></div>`);
    openDialog('個人註記', body, [{ text: '取消', fn: () => {} }, { text: '儲存', cls: 'primary', fn: () => { Store.set('cnote:' + id, body.querySelector('textarea').value.trim()); afterCaseChange(c.arts || []); } }]);
  }

  function openSettings() {
    const seg = (k, opts) => `<span class="seg" data-k="${k}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(S[k]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</span>`;
    const cnt = { ann: Store.keys('ann:').reduce((n, k) => n + Store.get(k, []).length, 0), note: Store.keys('note:').length, hl: Store.keys('hl:').length, ink: Store.keys('ink:').length, u: Store.get('ucases', []).length };
    const body = h(`<div>
      <div class="set-row"><span class="lbl">條文字級</span><span class="row"><button class="btn small" data-fs="-1">A−</button><b id="fsv">${S.fs}</b><button class="btn small" data-fs="1">A＋</button></span></div>
      <div class="set-row"><span class="lbl">條文字體</span>${seg('font', [['sans', '黑體'], ['serif', '明體']])}</div>
      <div class="set-row"><span class="lbl">外觀</span>${seg('theme', [['auto', '自動'], ['light', '淺色'], ['sepia', '護眼'], ['dark', '深色']])}</div>
      <div class="set-row"><span class="lbl">項次標示</span>${seg('pno', [['roman', 'Ⅰ Ⅱ'], ['circle', '① ②'], ['none', '不標示']])}</div>
      <div class="set-row"><span class="lbl">手寫<small>開啟時手指捲動、Apple Pencil 書寫</small></span>${seg('pencilOnly', [[true, '僅 Pencil'], [false, '手指也可寫']])}</div>
      <div class="set-row"><span class="lbl">顯示條文上的小字註記</span>${seg('showAnn', [[true, '顯示'], [false, '隱藏']])}</div>
      <div class="set-row"><span class="lbl">條文下顯示我的註記</span>${seg('showNotes', [[true, '顯示'], [false, '隱藏']])}</div>
      <div class="set-row"><span class="lbl">條文下顯示手寫筆記</span>${seg('showInk', [[true, '顯示'], [false, '隱藏']])}</div>
      <div class="set-row"><span class="lbl">條文內引用條號可點選</span>${seg('xref', [[true, '開'], [false, '關']])}</div>
      <h4 style="margin:18px 0 6px">備份與還原</h4>
      <p class="muted" style="margin-top:0">條文小字註記 ${cnt.ann} 則・註記本 ${cnt.note} 條・螢光 ${cnt.hl} 條・手寫 ${cnt.ink} 條・自訂判解 ${cnt.u} 則。資料只存在這台裝置的瀏覽器（${Store.mode === 'idb' ? 'IndexedDB' : Store.mode === 'ls' ? 'localStorage' : '暫存記憶體，關閉後會消失'}），建議定期匯出備份到「檔案」或 iCloud Drive。</p>
      <div class="row"><button class="btn primary" data-act="export">匯出備份</button><button class="btn" data-act="import">匯入備份</button><button class="btn danger" data-act="wipe">清除全部個人資料</button></div>
      <input type="file" accept="application/json,.json" hidden>
      <h4 style="margin:18px 0 6px">安裝到主畫面</h4>
      <p class="muted" style="margin-top:0">在 iPad Safari 點「分享」→「加入主畫面」，即可像 App 一樣全螢幕開啟並離線使用。</p>
      <p class="muted">資料版本：現行條文 ${D.meta.modifiedRoc}・修正 ${D.amendments.length} 次・大法官解釋 ${D.interps.length} 則・判決 ${BUILTIN_CASES.filter((c) => c.type === 'S').length} 則・函釋 ${BUILTIN_CASES.filter((c) => c.type === 'A').length} 則</p>
    </div>`);
    body.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const sg = b.closest('.seg');
      if (sg) {
        const k = sg.dataset.k; let v = b.dataset.v;
        if (v === 'true') v = true; else if (v === 'false') v = false;
        S[k] = v; saveSettings();
        $$('button', sg).forEach((x) => x.classList.toggle('on', x === b));
        rerenderAll();
      }
      if (b.dataset.fs) { S.fs = Math.min(30, Math.max(14, S.fs + +b.dataset.fs)); $('#fsv', body).textContent = S.fs; saveSettings(); }
      if (b.dataset.act === 'export') exportData();
      if (b.dataset.act === 'import') body.querySelector('input[type=file]').click();
      if (b.dataset.act === 'wipe') ask('確定清除所有註記、螢光、手寫、書籤與自訂判解？此動作無法復原（建議先匯出備份）。', '全部清除').then((ok) => {
        if (ok) Store.clearAll().then(() => { loadSettings(); rerenderAll(); dlg.close(); toast('已清除'); });
      });
    });
    body.querySelector('input[type=file]').onchange = (e) => { const f = e.target.files[0]; if (f) importData(f); };
    openDialog('設定與備份', body);
  }

  function rerenderAll() {
    const main = $('#main');
    const anchor = Store.get('last');
    renderLaw(); renderToc();
    if (curView === 'law' && anchor) { const el = document.getElementById('a-' + anchor); if (el) el.scrollIntoView({ block: 'start' }); }
    const amend = $('#view-amend'); delete amend.dataset.done;
    if (curView === 'amend') renderAmend();
    if (curView === 'cases') renderCasesView();
    if (curView === 'mine') renderMine();
    void main;
  }

  function exportData() {
    const data = {};
    Store.keys().forEach((k) => { data[k] = Store.get(k); });
    const payload = { app: 'lsa-codex', version: 1, exported: new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const d = new Date();
    const name = `勞基法法典備份-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
    const sandboxed = /claude|anthropic|usercontent/.test(location.hostname);
    if (sandboxed) showExportText(JSON.stringify(payload), name);
    else if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch((e) => { if (e && e.name !== 'AbortError') download(); });
    } else download();
    function download() {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    Store.set('lastExport', Date.now());
  }

  function importData(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const p = JSON.parse(r.result);
        if (p.app !== 'lsa-codex' || !p.data) throw new Error('不是本 App 的備份檔');
        const n = Object.keys(p.data).length;
        ask(`備份檔含 ${n} 筆資料（${(p.exported || '').slice(0, 10)}）。要如何匯入？`, '完全取代目前資料', '合併（同一條以備份為準）').then(async (r) => {
          if (r === null) return;
          if (r === true) await Store.clearAll();
          Object.entries(p.data).forEach(([k, v]) => Store.set(k, v));
          loadSettings(); rerenderAll(); dlg.close();
          toast('匯入完成');
        });
      } catch (e) { toast('匯入失敗：' + e.message); }
    };
    r.readAsText(file);
  }

  // in-page confirm (window.confirm is unavailable in some embedded viewers)
  function ask(msg, okText, altText) {
    return new Promise((res) => {
      const d = $('#ask');
      d.innerHTML = '';
      const body = h(`<div class="dlg-b" style="max-height:none"></div>`);
      body.textContent = msg;
      const f = h(`<div class="dlg-f"></div>`);
      const mk = (t, cls, v) => { const b = h(`<button class="btn ${cls}">${esc(t)}</button>`); b.onclick = () => { done = true; d.close(); res(v); }; f.append(b); };
      let done = false;
      mk('取消', '', altText ? null : false);
      if (altText) mk(altText, '', false);
      mk(okText || '確定', 'primary', true);
      d.append(body, f);
      d.onclose = () => { if (!done) res(altText ? null : false); };
      d.showModal();
    });
  }

  function showExportText(json, name) {
    const body = h(`<div><p class="muted" style="margin-top:0">此環境無法直接下載檔案。請按「複製」後貼到「備忘錄」或存成 ${esc(name)}；之後可用「匯入備份」選擇該檔案還原。</p>
      <div class="field"><textarea id="exportText" readonly style="min-height:200px;font-family:ui-monospace,monospace;font-size:12px"></textarea></div></div>`);
    $('textarea', body).value = json;
    openDialog('匯出備份', body, [{ text: '複製', cls: 'primary', fn: () => {
      const ta = $('textarea', body);
      navigator.clipboard.writeText(json).then(() => toast('已複製'), () => { ta.focus(); ta.select(); toast('請手動全選複製'); });
      return false;
    } }]);
  }

  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2400);
  }

  /* ------------------------------------------------------------------ *
   * global events
   * ------------------------------------------------------------------ */
  function bind() {
    $('#btnToc').onclick = () => {
      if (window.innerWidth >= 1024) document.body.classList.toggle('toc-hidden');
      else document.body.classList.toggle('toc-open');
    };
    $('#scrim').onclick = () => document.body.classList.remove('toc-open');
    $('#btnSettings').onclick = openSettings;
    $('#btnCollapseAll').onclick = () => { const ds = $$('#toc details'); const anyOpen = ds.some((d) => d.open); ds.forEach((d) => (d.open = !anyOpen)); $('#btnCollapseAll').textContent = anyOpen ? '全部展開' : '全部收合'; };
    $$('.view-btn').forEach((b) => (b.onclick = () => { $('#search').value = ''; showView(b.dataset.view); }));
    const si = $('#search');
    const ds = debounce(() => doSearch(si.value), 250);
    si.addEventListener('input', ds);
    si.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const no = parseArtNo(si.value);
        if (no) { si.value = ''; si.blur(); goArticle(no); }
        else doSearch(si.value);
      }
      if (e.key === 'Escape') { si.value = ''; doSearch(''); }
    });

    document.addEventListener('click', (e) => {
      const t = e.target;
      // navigation
      const go = t.closest('[data-go]');
      if (go && !t.closest('.toc') && go.dataset.go) {
        e.preventDefault();
        const hit = go.dataset.hit;
        if (go.closest('#view-search')) $('#search').value = '';
        goArticle(go.dataset.go, { hit, tab: go.dataset.tab, smooth: !!go.closest('.art-body') });
        return;
      }
      if (go && t.closest('.toc')) { goArticle(go.dataset.go); return; }

      const art = t.closest('.art');
      if (art) {
        const no = art.dataset.no;
        const act = t.closest('[data-act]')?.dataset.act;
        if (act === 'star') {
          const st = new Set(Store.get('stars', []));
          st.has(no) ? st.delete(no) : st.add(no);
          Store.set('stars', sortNos([...st]));
          t.closest('[data-act]').classList.toggle('on', st.has(no));
          updateTocMarks();
          toast(st.has(no) ? `已加入書籤：${label(no)}` : '已移除書籤');
          return;
        }
        if (act === 'detail') { openDetail.has(no) ? setDetail(no, null) : setDetail(no, 'note'); return; }
        if (act === 'open-note') { setDetail(no, 'note'); return; }
        if (act === 'open-ink') { setDetail(no, 'ink'); return; }
        const annEl = t.closest('.ann');
        if (annEl) { editAnn(no, +annEl.dataset.ann); return; }
        const badge = t.closest('.badge[data-tab]');
        if (badge) { setDetail(no, badge.dataset.tab, badge.dataset.f); return; }
        const tab = t.closest('.tab');
        if (tab) {
          const d = tab.closest('.detail');
          $$('.tab', d).forEach((x) => x.classList.toggle('active', x === tab));
          openDetail.set(no, tab.dataset.tabk);
          fillPanel($('.panel', d), no, tab.dataset.tabk);
          return;
        }
      }
      const card = t.closest('.case');
      if (card) {
        const act = t.closest('[data-act]')?.dataset.act;
        const id = card.dataset.id;
        if (act === 'expand') { const b = $('.case-body', card); b.classList.toggle('clamp'); t.textContent = b.classList.contains('clamp') ? '展開全文' : '收合'; }
        if (act === 'cnote') editCaseNote(id);
        if (act === 'edit') editCase(id);
        if (act === 'del') ask('刪除這則自訂資料？', '刪除').then((ok) => {
          if (!ok) return;
          const list = Store.get('ucases', []);
          const c = list.find((x) => x.id === id);
          Store.set('ucases', list.filter((x) => x.id !== id));
          Store.del('cnote:' + id);
          afterCaseChange(c ? c.arts : []);
        });
      }
    });

    window.addEventListener('hashchange', route);
    $('#main').addEventListener('scroll', () => { if (!hlbar.hidden && !window.getSelection().toString()) hlbar.hidden = true; }, { passive: true });
  }

  function route() {
    const hs = decodeURIComponent(location.hash.slice(1));
    if (['amend', 'cases', 'mine'].includes(hs)) showView(hs, false);
    else if (/^a/.test(hs) && ART.has(hs.slice(1))) goArticle(hs.slice(1));
  }

  /* ------------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------------ */
  async function boot() {
    await Store.init();
    loadSettings();
    $('#brandSub').textContent = `${D.meta.modifiedRoc} 修正・離線法典`;
    renderToc();
    renderLaw();
    bind();
    if (location.hash) route();
    else {
      const last = Store.get('last');
      if (last && ART.has(last)) { const el = document.getElementById('a-' + last); if (el) el.scrollIntoView({ block: 'start' }); }
    }
    if (Store.mode === 'memory') toast('此環境無法永久儲存，關閉後註記會消失，請記得匯出備份');
    const le = Store.get('lastExport');
    const hasData = Store.keys('note:').length + Store.keys('hl:').length + Store.keys('ink:').length > 0;
    if (hasData && (!le || Date.now() - le > 14 * 864e5)) setTimeout(() => toast('提醒：已超過兩週未備份註記，可至「設定」匯出'), 2500);

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/claude|anthropic|usercontent/.test(location.hostname)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // expose for tests
  window.__LSA = { diffChars, cn2n, parseArtNo, Store, xrefs };
  boot();
})();
