// ==UserScript==
// @name         问卷填表助手（问卷星 / 腾讯问卷 / WPS 表单）
// @namespace    https://github.com/MingNin9466/survey-autofill-helper
// @version      1.0.2
// @description  把自己的答案存成模板，一键填入问卷星 / 腾讯问卷 / WPS 表单；只填不交，提交仍由你自己点。
// @author       MingNin9466
// @homepageURL  https://github.com/MingNin9466/survey-autofill-helper
// @supportURL   https://github.com/MingNin9466/survey-autofill-helper/issues
// @updateURL    https://raw.githubusercontent.com/MingNin9466/survey-autofill-helper/main/survey-autofill-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/MingNin9466/survey-autofill-helper/main/survey-autofill-helper.user.js
// @match        *://*.wjx.cn/*
// @match        *://*.wjx.top/*
// @match        *://*.sojump.com/*
// @match        *://*.wj.qq.com/*
// @match        *://*.f.wps.cn/*
// @match        *://*.jinshuju.net/*
// @match        *://*.wenjuan.com/*
// @match        *://*.mikecrm.com/*
// @match        *://*.jsform.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

/*
 * 设计原则
 * 1. 只填不交：绝不调用 submit，也不点“提交”按钮。
 * 2. 结构优先：问卷星 / 腾讯问卷 用各自的真实 DOM 结构解析，其他站点走通用识别。
 * 3. 可核对：面板里能看到识别到哪些题、每题填了什么、成功还是失败。
 */

'use strict';

(function () {
  const VERSION = '1.0.2';
  const STORE_KEY = 'sfh_state_v1';
  const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  if (uw.__SFH_LOADED__) return;
  uw.__SFH_LOADED__ = true;

  /* ------------------------------------------------------------------ *
   * 0. 基础工具
   * ------------------------------------------------------------------ */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

  const CONTROL_SEL = [
    'input[type=radio]',
    'input[type=checkbox]',
    'select',
    'textarea',
    'input[type=text]',
    'input[type=number]',
    'input[type=email]',
    'input[type=tel]',
    'input[type=url]',
    'input[type=date]',
    'input[type=time]',
    'input:not([type])',
    '[contenteditable=true]',
  ].join(',');

  const CHOICE_SEL = 'input[type=radio],input[type=checkbox]';
  const TEXT_SEL =
    'textarea,input[type=text],input[type=number],input[type=email],input[type=tel],input[type=url],input[type=date],input[type=time],input:not([type]),[contenteditable=true]';

  function rawText(el) {
    if (!el) return '';
    return el.innerText || el.textContent || '';
  }

  function cleanText(s) {
    return String(s == null ? '' : s)
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function stripLeadingNumber(s) {
    return String(s)
      .replace(/^[\s*＊·•]+/, '')
      .replace(/^\s*(?:第\s*)?[0-9一二三四五六七八九十]{1,3}\s*[.、,，:：)）\]】]\s*/, '')
      .replace(/^\s*[(（]\s*\d{1,3}\s*[)）]\s*/, '');
  }

  function stripOptionPrefix(s) {
    return String(s)
      .replace(/^\s*[A-Za-z]\s*[.、,，:：)）]\s*/, '')
      .replace(/^\s*\d{1,2}\s*[.、)）]\s*/, '');
  }

  /** 题干归一化：去编号、去常见标注、去空白、去标点、转小写 */
  function normKey(s) {
    let t = cleanText(s).normalize('NFKC');
    t = stripLeadingNumber(t);
    t = t.replace(/[（(]\s*(?:必填|选填|多选|单选|可多选|限\d+字|不填)\s*[)）]/g, '');
    t = t.replace(/^\s*[【\[]\s*(?:单选|多选|必填|选填)\s*[】\]]\s*/, '');
    t = t.replace(/[\s\u3000]+/g, '');
    t = t.replace(/[?？!！。.、，,;；:："'“”‘’·]/g, '');
    return t.toLowerCase();
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ------------------------------------------------------------------ *
   * 1. 存储
   * ------------------------------------------------------------------ */

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  function defaultState() {
    return {
      version: 1,
      activeId: 'tpl-default',
      templates: [
        {
          id: 'tpl-default',
          name: '常用答案（示例）',
          updatedAt: Date.now(),
          rules: [
            { id: 'r1', kw: '性别', ans: '男' },
            { id: 'r2', kw: '职业|身份', ans: '学生' },
            { id: 'r3', kw: '学历|最高学历', ans: '本科' },
            { id: 'r4', kw: '年级', ans: '大一' },
            { id: 'r5', kw: '满意度|满意程度', ans: '满意' },
            { id: 'r6', kw: '建议|意见|看法', ans: '暂无' },
          ],
        },
      ],
      settings: {
        onlyEmpty: true,
        highlight: true,
        autoOpen: false,
        delayMin: 60,
        delayMax: 140,
      },
    };
  }

  function normalizeState(input) {
    const base = defaultState();
    const s = input && typeof input === 'object' ? input : {};
    const out = {
      version: 1,
      activeId: typeof s.activeId === 'string' ? s.activeId : '',
      templates: [],
      settings: Object.assign({}, base.settings, s.settings || {}),
    };

    const list = Array.isArray(s.templates) ? s.templates : [];
    for (const t of list) {
      if (!t || typeof t !== 'object') continue;
      const rules = Array.isArray(t.rules) ? t.rules : [];
      out.templates.push({
        id: String(t.id || uid('tpl')),
        name: String(t.name || '未命名模板').slice(0, 40),
        updatedAt: Number(t.updatedAt) || Date.now(),
        rules: rules
          .filter((r) => r && (r.kw || r.ans))
          .map((r) => ({
            id: String(r.id || uid('r')),
            kw: String(r.kw == null ? '' : r.kw),
            ans: String(r.ans == null ? '' : r.ans),
          })),
      });
    }
    if (!out.templates.length) out.templates = base.templates;
    if (!out.templates.some((t) => t.id === out.activeId)) out.activeId = out.templates[0].id;

    out.settings.delayMin = Math.max(0, Math.min(2000, Number(out.settings.delayMin) || 0));
    out.settings.delayMax = Math.max(out.settings.delayMin, Math.min(3000, Number(out.settings.delayMax) || out.settings.delayMin));
    out.settings.onlyEmpty = out.settings.onlyEmpty !== false;
    out.settings.highlight = out.settings.highlight !== false;
    out.settings.autoOpen = !!out.settings.autoOpen;
    return out;
  }

  function loadState() {
    let raw = null;
    try {
      raw = hasGM ? GM_getValue(STORE_KEY, '') : localStorage.getItem(STORE_KEY);
    } catch (e) {
      raw = null;
    }
    let parsed = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        parsed = null;
      }
    }
    return normalizeState(parsed);
  }

  let state = loadState();
  let saveTimer = 0;

  function save() {
    clearTimeout(saveTimer);
    const raw = JSON.stringify(state);
    try {
      if (hasGM) GM_setValue(STORE_KEY, raw);
      else localStorage.setItem(STORE_KEY, raw);
    } catch (e) {
      console.warn('[SFH] save failed', e);
    }
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
  }

  function activeTemplate() {
    return state.templates.find((t) => t.id === state.activeId) || state.templates[0];
  }

  /* ------------------------------------------------------------------ *
   * 2. 选项与答案匹配
   * ------------------------------------------------------------------ */

  function scoreOption(label, want) {
    const L0 = cleanText(label).normalize('NFKC');
    const W0 = cleanText(want).normalize('NFKC');
    if (!L0 || !W0) return 0;
    const L = normKey(L0);
    const W = normKey(W0);
    const Ls = normKey(stripOptionPrefix(L0));
    const Ws = normKey(stripOptionPrefix(W0));

    if (L === W) return 100;
    if (Ls && Ls === Ws) return 96;
    if (Ls && Ls === W) return 92;
    if (L && L === Ws) return 92;
    if (Ls && Ws && (Ls.startsWith(Ws) || Ls.startsWith(W))) return 74 + Math.min(Ws.length, 20);
    if (Ls && Ws && (Ls.includes(Ws) || Ls.includes(W))) return 62 + Math.min(Ws.length, 20);

    // 选项带 A. / B. / 1. 前缀时，允许用字母或序号作答
    const letter = (L0.match(/^\s*([A-Za-z])\s*[.、,，:：)）]/) || [])[1];
    if (letter) {
      const wantLetter = (W0.match(/^\s*([A-Za-z])\s*$/) || [])[1];
      if (wantLetter && wantLetter.toUpperCase() === letter.toUpperCase()) return 90;
    }
    const num = (L0.match(/^\s*(\d{1,2})\s*[.、)）]/) || [])[1];
    if (num && /^\d{1,2}$/.test(W0.trim()) && num === W0.trim()) return 88;

    return 0;
  }

  function bestOption(options, want, exclude) {
    const list = exclude && exclude.length ? options.filter((o) => exclude.indexOf(o) === -1) : options;
    const w = String(want == null ? '' : want).trim();
    if (!w || !list.length) return null;

    const idx = w.match(/^#\s*(\d+)$/) || w.match(/^A(\d+)$/i);
    if (idx) return list[Number(idx[1]) - 1] || null;

    let best = null;
    let bestScore = 0;
    for (const opt of list) {
      const s = scoreOption(opt.label, w);
      if (s > bestScore) {
        bestScore = s;
        best = opt;
      }
    }
    if (best) return best;

    if (/^\d{1,2}$/.test(w)) return list[Number(w) - 1] || null;
    return null;
  }

  function matchRule(titleNorm, rules) {
    let best = null;
    let bestScore = 0;
    for (const rule of rules || []) {
      if (!rule || !rule.kw) continue;
      const kws = String(rule.kw).split('|');
      for (const rawKw of kws) {
        const kw = normKey(rawKw);
        if (!kw) continue;
        let score = 0;
        if (titleNorm === kw) score = 200 + kw.length;
        else if (titleNorm.startsWith(kw)) score = 150 + kw.length;
        else if (titleNorm.includes(kw)) score = 120 + kw.length;
        if (score > bestScore) {
          bestScore = score;
          best = rule;
        }
      }
    }
    return best ? { rule: best, score: bestScore } : null;
  }

  /* ------------------------------------------------------------------ *
   * 3. 选中状态 / 点击 / 写入
   * ------------------------------------------------------------------ */

  function isSelected(opt) {
    if (!opt) return false;
    const input = opt.input;
    if (input && input.checked) return true;
    const nodes = [opt.clickEl, opt.wrapEl, opt.labelEl].filter(Boolean);
    for (const el of nodes) {
      const cls = String(el.className || '');
      if (/\b(checked|selected|active|is-checked|is-selected)\b/i.test(cls)) return true;
      if (el.getAttribute && el.getAttribute('aria-checked') === 'true') return true;
    }
    return false;
  }

  function nativeCheck(input, checked) {
    if (!input) return false;
    try {
      const proto = HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'checked');
      if (desc && desc.set) desc.set.call(input, checked);
      else input.checked = checked;
    } catch (e) {
      input.checked = checked;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.checked === checked;
  }

  function tryClick(el) {
    if (!el || typeof el.click !== 'function') return false;
    try {
      el.click();
      return true;
    } catch (e) {
      return false;
    }
  }

  function checkOption(opt) {
    if (!opt) return false;
    if (isSelected(opt)) return true;

    const order = [opt.clickEl, opt.labelEl, opt.input, opt.wrapEl].filter(Boolean);
    const seen = new Set();
    for (const el of order) {
      if (seen.has(el)) continue;
      seen.add(el);
      tryClick(el);
      if (isSelected(opt)) return true;
    }
    if (opt.input) {
      nativeCheck(opt.input, true);
      if (isSelected(opt)) return true;
    }
    return false;
  }

  function uncheckOption(opt) {
    if (!opt || !opt.input) return;
    if (!opt.input.checked) return;
    tryClick(opt.input);
    if (opt.input.checked) nativeCheck(opt.input, false);
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
      return String(el.textContent || '').trim() === String(value).trim();
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    try {
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
    } catch (e) {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return String(el.value || '').trim() === String(value).trim();
  }

  function fillSelect(el, want) {
    const opts = Array.from(el.options || []);
    if (!opts.length) return false;
    let best = null;
    let bestScore = 0;
    for (const o of opts) {
      const s = scoreOption(o.text, want);
      if (s > bestScore) {
        bestScore = s;
        best = o;
      }
    }
    if (!best && /^\d{1,2}$/.test(String(want).trim())) best = opts[Number(want) - 1] || null;
    if (!best) return false;
    try {
      const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(el, best.value);
      else el.value = best.value;
    } catch (e) {
      el.value = best.value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value === best.value;
  }

  /** antd Select（WPS 表单的下拉题）：点开下拉面板，再点选项 */
  async function fillAntSelect(q, want) {
    const sel = q.container.querySelector('.ant-select');
    if (!sel) return { ok: false, msg: '找不到下拉框' };
    const trigger = sel.querySelector('.ant-select-selector') || sel;
    try {
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    } catch (e) {
      /* ignore */
    }
    trigger.click();
    await sleep(220);

    const dropdowns = $$('.ant-select-dropdown').filter(
      (d) => !/hidden/i.test(String(d.className)) && d.getBoundingClientRect().height > 0
    );
    const dd = dropdowns[dropdowns.length - 1];
    if (!dd) return { ok: false, msg: '下拉框没有展开' };
    const options = $$('.ant-select-item-option', dd).filter((o) => !/disabled/i.test(String(o.className)));
    if (!options.length) return { ok: false, msg: '下拉框没有选项' };

    const wantText = String(want).trim();
    const picks = [];
    if (/^(随机|random|rand|r)$/i.test(wantText)) {
      picks.push(options[rand(0, options.length - 1)]);
    } else {
      const parts = wantText.split(/[|｜,，、;；]+/).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        let best = null;
        let bestScore = 0;
        for (const opt of options) {
          const s = scoreOption(rawText(opt), part);
          if (s > bestScore) {
            bestScore = s;
            best = opt;
          }
        }
        if (!best) {
          const m = part.match(/^#\s*(\d+)$/) || part.match(/^A(\d+)$/i);
          if (m) best = options[Number(m[1]) - 1] || null;
          else if (/^\d{1,2}$/.test(part)) best = options[Number(part) - 1] || null;
        }
        if (best && picks.indexOf(best) === -1) picks.push(best);
      }
    }
    if (!picks.length) return { ok: false, msg: '没有选项匹配「' + wantText + '」' };

    for (const opt of picks) {
      try {
        opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      } catch (e) {
        /* ignore */
      }
      opt.click();
      await sleep(120);
    }
    const shown = cleanText(rawText(sel.querySelector('.ant-select-selection-item') || sel));
    return shown ? { ok: true, msg: shown } : { ok: false, msg: '选择未生效' };
  }

  /* ------------------------------------------------------------------ *
   * 4. 题目对象
   * ------------------------------------------------------------------ */

  function makeOption(spec) {
    const opt = {
      input: spec.input || null,
      clickEl: spec.clickEl || null,
      labelEl: spec.labelEl || null,
      wrapEl: spec.wrapEl || null,
      label: cleanText(spec.label || ''),
      value: spec.input ? spec.input.value : '',
    };
    opt.__isSel = () => isSelected(opt);
    return opt;
  }

  function makeQuestion(spec) {
    const q = {
      id: spec.id || uid('q'),
      source: spec.source || '',
      container: spec.container,
      title: stripLeadingNumber(cleanText(spec.title || '')),
      kind: spec.kind || 'unknown',
      options: spec.options || [],
      textEls: spec.textEls || [],
      unsupported: spec.unsupported || '',
      index: spec.index || 0,
    };
    q.titleNorm = normKey(q.title);

    q.isFilled = function () {
      if (q.kind === 'text') {
        return q.textEls.some((el) => String(el.value == null ? el.textContent : el.value).trim() !== '');
      }
      if (q.kind === 'select') {
        return q.textEls.some((el) => el && String(el.value || '').trim() !== '');
      }
      if (q.kind === 'antselect') {
        const sel = q.container.querySelector('.ant-select');
        return !!(sel && sel.querySelector('.ant-select-selection-item'));
      }
      if (q.kind === 'single' || q.kind === 'multi') {
        return q.options.some(isSelected);
      }
      return false;
    };

    q.apply = async function (ans) {
      return applyAnswer(q, ans);
    };

    return q;
  }

  function pickOptions(q, ans) {
    const opts = q.options.filter((o) => o.input || o.clickEl);
    if (!opts.length) return [];
    const a = String(ans == null ? '' : ans).trim();
    if (!a) return [];

    if (/^(随机|随机选|random|rand|r)$/i.test(a)) {
      if (q.kind === 'multi') return shuffle(opts).slice(0, rand(1, Math.min(3, opts.length)));
      return [opts[rand(0, opts.length - 1)]];
    }
    const mRand = a.match(/^随机\s*(\d+)$/);
    if (mRand) {
      return shuffle(opts).slice(0, Math.max(1, Math.min(Number(mRand[1]), opts.length)));
    }

    const parts = a.split(/[|｜,，、;；]+/).map((s) => s.trim()).filter(Boolean);
    const picks = [];
    const exclude = [];
    for (const part of parts) {
      const hit = bestOption(opts, part, exclude);
      if (hit) {
        picks.push(hit);
        exclude.push(hit);
      }
      if (q.kind === 'single' && picks.length) break;
    }
    return picks;
  }

  async function applyAnswer(q, ans) {
    if (q.unsupported) return { ok: false, msg: q.unsupported };
    const answer = String(ans == null ? '' : ans).trim();
    if (!answer) return { ok: false, msg: '模板答案为空白' };

    if (q.kind === 'text') {
      const el = q.textEls.find((e) => isVisible(e)) || q.textEls[0];
      if (!el) return { ok: false, msg: '找不到输入框' };
      const ok = setNativeValue(el, answer);
      return ok ? { ok: true, msg: answer } : { ok: false, msg: '写入失败' };
    }

    if (q.kind === 'select') {
      const el = q.textEls[0] || q.container.querySelector('select');
      if (!el) return { ok: false, msg: '找不到下拉框' };
      const ok = fillSelect(el, answer);
      return ok ? { ok: true, msg: answer } : { ok: false, msg: '没有匹配的选项' };
    }

    if (q.kind === 'antselect') {
      return await fillAntSelect(q, answer);
    }

    if (q.kind !== 'single' && q.kind !== 'multi') {
      return { ok: false, msg: '暂不支持该题型' };
    }

    const picks = pickOptions(q, answer);
    if (!picks.length) {
      return { ok: false, msg: '没有选项匹配「' + answer + '」' };
    }

    let done = 0;
    for (const opt of picks) {
      if (isSelected(opt)) {
        done += 1;
        continue;
      }
      checkOption(opt);
      await sleep(25);
      if (isSelected(opt)) done += 1;
    }

    if (q.kind === 'single') {
      const hit = picks[0];
      return isSelected(hit)
        ? { ok: true, msg: hit.label || hit.value || '已选中' }
        : { ok: false, msg: '点击后未选中：' + (hit.label || '') };
    }
    if (!done) return { ok: false, msg: '多选一个都没选中' };
    return { ok: true, msg: '选中 ' + done + '/' + picks.length + ' 项' };
  }

  /* ------------------------------------------------------------------ *
   * 5. 各问卷平台的解析器
   * ------------------------------------------------------------------ */

  const host = location.hostname;

  /** 问卷星：div.field > .field-label(.topichtml) + .ui-radio/.ui-checkbox(a.jqradio) */
  const wjxAdapter = {
    id: 'wjx',
    name: '问卷星',
    test() {
      return /(^|\.)(wjx\.cn|wjx\.top|sojump\.com)$/i.test(host);
    },
    collect() {
      const out = [];
      const fields = $$('#divQuestion div.field, div.field.ui-field-contain');
      const seen = new Set();
      for (const field of fields) {
        if (seen.has(field)) continue;
        seen.add(field);
        if (field.closest('.cutfield')) continue;

        const titleEl = field.querySelector('.topichtml') || field.querySelector('.field-label');
        const title = cleanText(rawText(titleEl));
        if (!title) continue;

        const id = field.getAttribute('topic') || field.id || uid('wjx');
        const hasTable = !!field.querySelector('table');
        const radios = $$('input[type=radio]', field);
        const checks = $$('input[type=checkbox]', field);
        const select = field.querySelector('select');
        const texts = $$(TEXT_SEL, field).filter(
          (el) => !el.closest('.ui-radio,.ui-checkbox') && el.type !== 'hidden'
        );

        if (hasTable) {
          out.push(makeQuestion({ id, source: 'wjx', container: field, title, kind: 'matrix', unsupported: '矩阵/表格题暂不支持，请手动填写' }));
          continue;
        }

        if (radios.length) {
          const options = radios.map((input) => {
            const wrap = input.closest('.ui-radio') || input.closest('.ui-controlgroup-item') || input.parentElement;
            const labelEl = (wrap && wrap.querySelector('.label')) || wrap;
            const clickEl = (wrap && wrap.querySelector('a.jqradio')) || labelEl;
            return makeOption({ input, labelEl, clickEl, wrapEl: wrap, label: rawText(labelEl) });
          });
          out.push(makeQuestion({ id, source: 'wjx', container: field, title, kind: 'single', options }));
          continue;
        }

        if (checks.length) {
          const options = checks.map((input) => {
            const wrap = input.closest('.ui-checkbox') || input.closest('.ui-controlgroup-item') || input.parentElement;
            const labelEl = (wrap && wrap.querySelector('.label')) || wrap;
            const clickEl = (wrap && wrap.querySelector('a.jqcheckbox')) || labelEl;
            return makeOption({ input, labelEl, clickEl, wrapEl: wrap, label: rawText(labelEl) });
          });
          out.push(makeQuestion({ id, source: 'wjx', container: field, title, kind: 'multi', options }));
          continue;
        }

        if (select) {
          out.push(makeQuestion({ id, source: 'wjx', container: field, title, kind: 'select', textEls: [select] }));
          continue;
        }

        if (texts.length) {
          out.push(makeQuestion({ id, source: 'wjx', container: field, title, kind: 'text', textEls: texts }));
          continue;
        }

        out.push(makeQuestion({ id, source: 'wjx', container: field, title, kind: 'unknown', unsupported: '未识别的题型（文件/排序/评分等），请手动填写' }));
      }
      return out;
    },
  };

  /** 腾讯问卷：section.question > .question-title .text + .checkbox-option > label.checkbox-cell */
  const qqAdapter = {
    id: 'qq',
    name: '腾讯问卷',
    test() {
      return /(^|\.)wj\.qq\.com$/i.test(host);
    },
    collect() {
      const out = [];
      const sections = $$('section.question, .question[data-question-id]');
      for (const sec of sections) {
        const titleEl =
          sec.querySelector('.question-title .text') ||
          sec.querySelector('.question-title') ||
          sec.querySelector('.question-head');
        const title = cleanText(rawText(titleEl));
        if (!title) continue;

        const id = sec.getAttribute('data-question-id') || sec.id || uid('qq');
        const cls = String(sec.className || '');
        if (/question-type-(matrix|sort|file|upload)/i.test(cls)) {
          out.push(makeQuestion({ id, source: 'qq', container: sec, title, kind: 'matrix', unsupported: '矩阵/排序/文件题暂不支持，请手动填写' }));
          continue;
        }

        const radios = $$('input[type=radio]', sec);
        const checks = $$('input[type=checkbox]', sec);
        const select = sec.querySelector('select');
        const texts = $$(TEXT_SEL, sec).filter((el) => el.type !== 'hidden' && !el.closest('.checkbox-option'));

        const buildOptions = (inputs) =>
          inputs.map((input) => {
            let labelEl = null;
            if (input.id) {
              try {
                labelEl = sec.querySelector('label[for="' + CSS.escape(input.id) + '"]');
              } catch (e) {
                labelEl = null;
              }
            }
            if (!labelEl) labelEl = input.closest('label');
            const wrap = input.closest('.checkbox-option') || (labelEl && labelEl.parentElement) || input.parentElement;
            const textEl = (labelEl && (labelEl.querySelector('.cell-m') || labelEl)) || wrap;
            return makeOption({ input, labelEl, clickEl: labelEl || wrap, wrapEl: wrap, label: rawText(textEl) });
          });

        if (radios.length) {
          out.push(makeQuestion({ id, source: 'qq', container: sec, title, kind: 'single', options: buildOptions(radios) }));
        } else if (checks.length) {
          out.push(makeQuestion({ id, source: 'qq', container: sec, title, kind: 'multi', options: buildOptions(checks) }));
        } else if (select) {
          out.push(makeQuestion({ id, source: 'qq', container: sec, title, kind: 'select', textEls: [select] }));
        } else if (texts.length) {
          out.push(makeQuestion({ id, source: 'qq', container: sec, title, kind: 'text', textEls: texts }));
        } else {
          out.push(makeQuestion({ id, source: 'qq', container: sec, title, kind: 'unknown', unsupported: '未识别的题型，请手动填写' }));
        }
      }
      return out;
    },
  };

  /** WPS 表单（金山表单）：f.wps.cn/ksform/w/write/xxx，antd 组件 */
  const wpsAdapter = {
    id: 'wps',
    name: 'WPS表单',
    test() {
      return /(^|\.)f\.wps\.cn$/i.test(host);
    },
    collect() {
      const out = [];
      const loginTip = document.querySelector('.src-components-banner-error-index__loginTip');
      const bannerEl = document.querySelector('.src-pages-form-write-index__timeError');
      const banner = cleanText(rawText(bannerEl));
      let globalBlock = '';
      if (loginTip || /需要登录/.test(banner)) {
        globalBlock = '此表单需要登录 WPS 账号才能填写，先登录再点填充';
      } else if (/已达上限|停止收集|无法继续填写|已结束|不在填写时间|暂未开始/.test(banner)) {
        globalBlock = '表单已停止收集：' + banner.slice(0, 40);
      }

      const buildOptions = (inputs) =>
        inputs.map((input) => {
          const wrap = input.closest('.ant-radio-wrapper, .ant-checkbox-wrapper');
          const labelEl = (wrap && (wrap.querySelector('.ksapc-select-write-tile-select-val') || wrap)) || input.parentElement;
          return makeOption({ input, labelEl, clickEl: wrap || labelEl, wrapEl: wrap, label: rawText(labelEl) });
        });

      const containers = $$('.ksapc-questions-write-container');
      for (const container of containers) {
        const titleEl = container.querySelector('.ksapc-question-title-title');
        if (!titleEl) continue; // 分页条 / 纯文字说明块，不是题目
        const title = cleanText(rawText(titleEl));
        if (!title) continue;
        const id = container.id || uid('wps');

        const radios = $$('input.ant-radio-input', container);
        const checks = $$('input.ant-checkbox-input', container);
        const select = container.querySelector('.ant-select');
        const texts = $$('textarea.ant-input, input.ant-input', container).filter((el) => el.type !== 'file');
        const fileInput = container.querySelector('input[type=file]');
        const hasDate = !!container.querySelector('.ant-picker');
        const hasRegion = !!container.querySelector('.ant-cascader, .ksapc-region-select');
        const firstControl = container.querySelector('input, textarea');
        const disabled = !!(firstControl && firstControl.disabled);

        let unsupported = globalBlock;
        if (!unsupported && disabled) unsupported = '本题当前不可填写（表单已关闭收集，或需要先登录 WPS）';
        if (!unsupported && hasDate) unsupported = '日期题请手动选择';
        if (!unsupported && hasRegion) unsupported = '省/市/区选择题请手动选';

        if (unsupported) {
          out.push(makeQuestion({ id, source: 'wps', container, title, kind: 'unknown', unsupported }));
          continue;
        }

        if (radios.length) {
          out.push(makeQuestion({ id, source: 'wps', container, title, kind: 'single', options: buildOptions(radios) }));
          continue;
        }
        if (checks.length) {
          out.push(makeQuestion({ id, source: 'wps', container, title, kind: 'multi', options: buildOptions(checks) }));
          continue;
        }
        if (select) {
          out.push(makeQuestion({ id, source: 'wps', container, title, kind: 'antselect' }));
          continue;
        }
        if (texts.length) {
          out.push(makeQuestion({ id, source: 'wps', container, title, kind: 'text', textEls: texts }));
          continue;
        }
        out.push(
          makeQuestion({
            id,
            source: 'wps',
            container,
            title,
            kind: 'unknown',
            unsupported: fileInput ? '上传题请手动操作' : '未识别的题型，请手动填写',
          })
        );
      }
      return out;
    },
  };

  /** 通用识别：给金数据、问卷网、麦客等结构未知/易变的站点兜底 */
  const genericAdapter = {
    id: 'generic',
    name: '通用识别',
    test() {
      return true;
    },
    collect() {
      const groups = new Map();
      const controls = $$(CONTROL_SEL).filter(
        (el) => !el.closest('#sfh-host') && el.type !== 'hidden' && el.tagName !== 'BUTTON'
      );

      for (const el of controls) {
        const box = findQuestionBox(el);
        if (!box) continue;
        if (!groups.has(box)) groups.set(box, []);
        groups.get(box).push(el);
      }

      const out = [];
      let idx = 0;
      for (const [box, els] of groups) {
        idx += 1;
        const title = guessTitle(box, els);
        const id = box.id || box.getAttribute('data-question-id') || uid('g');

        const radios = els.filter((e) => e.type === 'radio');
        const checks = els.filter((e) => e.type === 'checkbox');
        const select = els.find((e) => e.tagName === 'SELECT');
        const texts = els.filter((e) => TEXT_SEL && e.matches && e.matches(TEXT_SEL));

        if (radios.length || checks.length) {
          const inputs = radios.length ? radios : checks;
          const options = inputs.map((input) => {
            let labelEl = null;
            if (input.id) {
              try {
                labelEl = box.querySelector('label[for="' + CSS.escape(input.id) + '"]') || document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
              } catch (e) {
                labelEl = null;
              }
            }
            if (!labelEl) labelEl = input.closest('label');
            const wrap = labelEl ? labelEl.parentElement : input.parentElement;
            const label = labelEl ? rawText(labelEl) : siblingText(input);
            return makeOption({ input, labelEl, clickEl: labelEl || wrap, wrapEl: wrap, label });
          });
          const kind = radios.length ? 'single' : 'multi';
          if (radios.length && checks.length) {
            out.push(makeQuestion({ id, source: 'generic', title, kind: 'unknown', container: box, unsupported: '本题同时含单选和多选控件，请手动填写', index: idx }));
          } else {
            out.push(makeQuestion({ id, source: 'generic', title, kind, options, container: box, index: idx }));
          }
          continue;
        }

        if (select) {
          out.push(makeQuestion({ id, source: 'generic', title, kind: 'select', textEls: [select], container: box, index: idx }));
          continue;
        }

        if (texts.length) {
          out.push(makeQuestion({ id, source: 'generic', title, kind: 'text', textEls: texts, container: box, index: idx }));
          continue;
        }
      }
      return out;
    },
  };

  function siblingText(input) {
    const parts = [];
    let node = input.parentElement;
    for (let i = 0; node && i < 3; i += 1) {
      const t = cleanText(rawText(node));
      if (t && t.length < 120) {
        parts.push(t);
        break;
      }
      node = node.parentElement;
    }
    return parts.join(' ');
  }

  function findQuestionBox(el) {
    let node = el;
    for (let i = 0; i < 8 && node && node !== document.body; i += 1) {
      const cls = String(node.className || '');
      if (/question|field|topic|form-?item|q-?item|control-?group|option-?group/i.test(cls)) {
        if (node.querySelectorAll(CONTROL_SEL).length >= 1) return node;
      }
      node = node.parentElement;
    }
    node = el.parentElement;
    for (let i = 0; i < 5 && node && node !== document.body; i += 1) {
      const t = rawText(node).length;
      if (t > 4 && t < 800 && node.querySelectorAll(CONTROL_SEL).length >= 2) return node;
      node = node.parentElement;
    }
    return null;
  }

  function guessTitle(box, els) {
    const aria = box.getAttribute && box.getAttribute('aria-label');
    if (aria && cleanText(aria).length > 1) return cleanText(aria);

    for (const sel of ['.question-title', '.title', '.topic', '.field-label', 'legend', '.question-title-text']) {
      const el = box.querySelector(sel);
      if (el && cleanText(rawText(el)).length > 1) return cleanText(rawText(el)).slice(0, 200);
    }

    let full = cleanText(rawText(box));
    const optionTexts = [];
    for (const el of els) {
      if (el.type !== 'radio' && el.type !== 'checkbox') continue;
      let labelEl = null;
      if (el.id) {
        try {
          labelEl = box.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        } catch (e) {
          labelEl = null;
        }
      }
      if (!labelEl) labelEl = el.closest('label');
      const t = cleanText(rawText(labelEl || el.parentElement));
      if (t && t.length < 200) optionTexts.push(t);
    }
    for (const t of optionTexts) full = full.split(t).join(' ');
    full = full.replace(/\*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    full = stripLeadingNumber(full);
    return full.slice(0, 200);
  }

  const ADAPTERS = [wjxAdapter, qqAdapter, wpsAdapter, genericAdapter];

  function pickAdapter(forcedId) {
    if (forcedId) return ADAPTERS.find((a) => a.id === forcedId) || genericAdapter;
    return ADAPTERS.find((a) => a.test()) || genericAdapter;
  }

  function scan(opts) {
    const options = opts || {};
    const adapter = pickAdapter(options.adapter);
    let questions = [];
    try {
      questions = adapter.collect() || [];
    } catch (e) {
      console.warn('[SFH] scan error', e);
      questions = [];
    }
    return questions.filter((q) => q && q.title);
  }

  /* ------------------------------------------------------------------ *
   * 6. 填充流程
   * ------------------------------------------------------------------ */

  function markQuestion(q, status) {
    if (!state.settings.highlight || !q.container) return;
    const color = status === 'ok' ? '#16a34a' : status === 'skip' ? '#94a3b8' : '#dc2626';
    const el = q.container;
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '2px solid ' + color;
    el.style.outlineOffset = '2px';
    el.style.borderRadius = el.style.borderRadius || '4px';
    setTimeout(() => {
      el.style.outline = prevOutline || '';
      el.style.outlineOffset = prevOffset || '';
    }, 2600);
  }

  async function fillQuestions(opts) {
    const options = opts || {};
    const onlyEmpty = options.onlyEmpty == null ? !!state.settings.onlyEmpty : !!options.onlyEmpty;
    const rules = activeTemplate().rules || [];
    const delayMin = Math.max(0, Number(state.settings.delayMin) || 0);
    const delayMax = Math.max(delayMin, Number(state.settings.delayMax) || delayMin);

    const questions = scan({ adapter: options.adapter });
    const results = [];
    let ok = 0;
    let skipped = 0;
    let failed = 0;
    let unmatched = 0;

    for (const q of questions) {
      if (q.unsupported) {
        results.push({ q, status: 'skip', msg: q.unsupported });
        skipped += 1;
        markQuestion(q, 'skip');
        continue;
      }
      if (!q.options.length && !q.textEls.length && q.kind !== 'antselect') {
        results.push({ q, status: 'skip', msg: '没有可填控件' });
        skipped += 1;
        continue;
      }
      if (onlyEmpty && q.isFilled()) {
        results.push({ q, status: 'skip', msg: '已有答案，跳过' });
        skipped += 1;
        markQuestion(q, 'skip');
        continue;
      }
      const m = matchRule(q.titleNorm, rules);
      if (!m) {
        results.push({ q, status: 'unmatched', msg: '没有匹配的模板规则' });
        unmatched += 1;
        continue;
      }
      let res;
      try {
        res = await q.apply(m.rule.ans);
      } catch (e) {
        res = { ok: false, msg: '出错：' + (e && e.message ? e.message : e) };
      }
      if (res.ok) {
        ok += 1;
        results.push({ q, status: 'ok', msg: res.msg, rule: m.rule });
        markQuestion(q, 'ok');
      } else {
        failed += 1;
        results.push({ q, status: 'fail', msg: res.msg, rule: m.rule });
        markQuestion(q, 'fail');
      }
      if (delayMax > 0) await sleep(rand(delayMin, delayMax));
    }

    return { results, ok, skipped, failed, unmatched, total: questions.length, keys: results.map((r) => r.q.id) };
  }

  /* ------------------------------------------------------------------ *
   * 7. 面板 UI
   * ------------------------------------------------------------------ */

  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { position: fixed; right: 18px; bottom: 88px; z-index: 2147483001; font: 13px/1.55 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #1f2937; }
    .fab { position: absolute; right: 0; bottom: 0; width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
      background: linear-gradient(135deg, #2563eb, #4f46e5); color: #fff; font-size: 15px; font-weight: 600;
      box-shadow: 0 8px 20px rgba(37, 99, 235, .35); transition: transform .15s ease; }
    .fab:hover { transform: translateY(-2px); }
    .panel { width: 372px; max-height: 74vh; background: #fff; border-radius: 14px; overflow: hidden;
      box-shadow: 0 18px 50px rgba(15, 23, 42, .25); border: 1px solid #e5e7eb; display: flex; flex-direction: column;
      margin-bottom: 62px; }
    .panel[hidden] { display: none; }
    .hd { padding: 10px 12px 8px; background: linear-gradient(135deg, #eff6ff, #eef2ff); border-bottom: 1px solid #e5e7eb; cursor: move; user-select: none; }
    .hd-t { display: flex; align-items: center; justify-content: space-between; }
    .hd-t b { font-size: 13.5px; color: #111827; }
    .ver { font-size: 11px; color: #6b7280; }
    .hd-a { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
    .site { font-size: 11.5px; color: #2563eb; }
    .mini { border: none; background: transparent; color: #6b7280; cursor: pointer; font-size: 12px; padding: 2px 4px; }
    .mini:hover { color: #111827; }
    .tabs { display: flex; border-bottom: 1px solid #e5e7eb; background: #fff; }
    .tabs button { flex: 1; border: none; background: transparent; padding: 8px 0; font-size: 12.5px; color: #6b7280; cursor: pointer; border-bottom: 2px solid transparent; }
    .tabs button.on { color: #2563eb; border-bottom-color: #2563eb; font-weight: 600; }
    main { padding: 10px 12px; overflow-y: auto; flex: 1; min-height: 120px; }
    .ft { padding: 7px 12px; font-size: 11px; color: #9ca3af; background: #f9fafb; border-top: 1px solid #f1f5f9; }
    .row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
    .btn { border: 1px solid #d1d5db; background: #fff; color: #374151; border-radius: 8px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; }
    .btn:hover { border-color: #9ca3af; }
    .btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
    .btn.primary:hover { background: #1d4ed8; }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .hint { font-size: 11.5px; color: #6b7280; }
    .list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .item { border: 1px solid #eef2f7; border-radius: 9px; padding: 7px 9px; background: #fbfdff; }
    .item .t { font-size: 12.5px; color: #111827; line-height: 1.45; display: flex; gap: 6px; }
    .item .seq { color: #9ca3af; flex: none; }
    .item .m { font-size: 11.5px; color: #6b7280; margin-top: 3px; }
    .item.ok { border-color: #bbf7d0; background: #f0fdf4; }
    .item.fail { border-color: #fecaca; background: #fef2f2; }
    .item.skip { border-color: #e5e7eb; background: #f9fafb; }
    .item.unknown { border-color: #fde68a; background: #fffbeb; }
    .tag { display: inline-block; padding: 0 6px; border-radius: 6px; background: #eef2ff; color: #4338ca; font-size: 10.5px; }
    .tag.multi { background: #fef3c7; color: #b45309; }
    .tag.text { background: #dcfce7; color: #15803d; }
    .tag.no { background: #fee2e2; color: #b91c1c; }
    .ans-input { width: 100%; margin-top: 5px; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 7px; font-size: 12px; }
    .ans-input:focus { outline: 2px solid #bfdbfe; border-color: #93c5fd; }
    .opts { font-size: 11px; color: #9ca3af; margin-top: 3px; }
    select.tpl-sel { flex: 1; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 7px; font-size: 12px; background: #fff; }
    .rule { display: grid; grid-template-columns: 1fr 1fr 22px; gap: 6px; margin-bottom: 6px; align-items: center; }
    .rule input { width: 100%; padding: 5px 7px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12px; }
    .rule .del { border: none; background: transparent; color: #ef4444; cursor: pointer; font-size: 14px; }
    label.set { display: flex; align-items: center; gap: 7px; margin: 7px 0; font-size: 12.5px; color: #374151; }
    input.num { width: 62px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12px; }
    .toast { position: fixed; right: 18px; bottom: 156px; z-index: 2147483002; max-width: 300px; background: #111827; color: #fff;
      padding: 8px 12px; border-radius: 8px; font-size: 12px; box-shadow: 0 10px 24px rgba(0,0,0,.25); opacity: 0; transform: translateY(6px);
      transition: all .18s ease; pointer-events: none; }
    .toast.show { opacity: 1; transform: translateY(0); }
    .jsonbox { width: 100%; height: 120px; margin-top: 6px; font: 11px/1.4 Consolas, monospace; padding: 6px; border: 1px solid #d1d5db; border-radius: 8px; }
    [hidden] { display: none !important; }
  `;

  const PANEL_HTML = `
    <div class="wrap">
      <div class="panel" hidden>
        <header class="hd">
          <div class="hd-t"><b>问卷填表助手</b><span class="ver">v${VERSION}</span></div>
          <div class="hd-a"><span class="site">识别：—</span><button class="mini" data-act="close">收起</button></div>
        </header>
        <nav class="tabs">
          <button data-tab="fill" class="on">填充</button>
          <button data-tab="scan">抓题</button>
          <button data-tab="tpl">模板</button>
          <button data-tab="cfg">设置</button>
        </nav>
        <main id="sfh-body"></main>
        <footer class="ft">只填不交 · 提交按钮请自己点</footer>
      </div>
      <button class="fab" title="打开问卷填表助手">填</button>
      <div class="toast" id="sfh-toast"></div>
    </div>
  `;

  const ui = {
    host: null,
    root: null,
    panel: null,
    body: null,
    fab: null,
    site: null,
    toastEl: null,
    tab: 'fill',
    lastFill: null,
    lastScan: null,
    scanAnswers: {},
  };

  function toast(msg) {
    if (!ui.toastEl) return;
    ui.toastEl.textContent = msg;
    ui.toastEl.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => ui.toastEl.classList.remove('show'), 2600);
  }

  function buildUI() {
    if (ui.root) return;
    const hostEl = document.createElement('div');
    hostEl.id = 'sfh-host';
    document.documentElement.appendChild(hostEl);
    const shadow = hostEl.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>' + PANEL_CSS + '</style>' + PANEL_HTML;

    ui.host = hostEl;
    ui.root = shadow;
    ui.panel = shadow.querySelector('.panel');
    ui.body = shadow.querySelector('#sfh-body');
    ui.fab = shadow.querySelector('.fab');
    ui.site = shadow.querySelector('.site');
    ui.toastEl = shadow.querySelector('#sfh-toast');

    ui.fab.addEventListener('click', () => togglePanel());
    shadow.addEventListener('click', onClick);
    shadow.addEventListener('input', onInput);
    shadow.addEventListener('change', onChange);
    shadow.querySelector('.hd').addEventListener('mousedown', onHeaderDown);

    // 有些问卷站（如问卷星）在 document 上拦 Backspace/Delete 防止浏览器后退。
    // 影子 DOM 会把事件 target 重定向成宿主 div，页面就误判“焦点不在输入框”而拦掉按键，
    // 导致面板里的输入框删不掉字。把面板内的按键/剪贴板事件截停在影子树里即可。
    [
      'keydown',
      'keyup',
      'keypress',
      'beforeinput',
      'input',
      'paste',
      'copy',
      'cut',
      'compositionstart',
      'compositionupdate',
      'compositionend',
      'contextmenu',
    ].forEach((type) => {
      shadow.addEventListener(type, (e) => e.stopPropagation());
    });

    updateSite();
    render();
  }

  function updateSite() {
    if (!ui.site) return;
    const adapter = pickAdapter();
    const count = safeScanCount();
    ui.site.textContent = '识别：' + adapter.name + (count != null ? '（' + count + ' 道题）' : '');
  }

  function safeScanCount() {
    try {
      return scan().length;
    } catch (e) {
      return null;
    }
  }

  function togglePanel(force) {
    if (!ui.panel) return;
    const open = force != null ? !!force : ui.panel.hidden;
    ui.panel.hidden = !open;
    ui.fab.textContent = open ? '×' : '填';
    if (open) {
      updateSite();
      render();
    }
  }

  let dragState = null;

  function onHeaderDown(e) {
    if (e.button !== 0 || (e.target.closest && e.target.closest('button'))) return;
    const rect = ui.panel.getBoundingClientRect();
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(ui.panel.style.transform || '');
    const ox = m ? parseFloat(m[1]) : 0;
    const oy = m ? parseFloat(m[2]) : 0;
    dragState = {
      sx: e.clientX,
      sy: e.clientY,
      ox,
      oy,
      left: rect.left - ox,
      top: rect.top - oy,
      w: rect.width,
      h: rect.height,
    };
    const move = (ev) => {
      if (!dragState) return;
      let x = dragState.ox + (ev.clientX - dragState.sx);
      let y = dragState.oy + (ev.clientY - dragState.sy);
      const left = dragState.left + x;
      const top = dragState.top + y;
      x += Math.max(4 - left, Math.min(window.innerWidth - 4 - (left + dragState.w), 0));
      y += Math.max(4 - top, Math.min(window.innerHeight - 4 - (top + dragState.h), 0));
      ui.panel.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    };
    const up = () => {
      dragState = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    e.preventDefault();
  }

  function setTab(tab) {
    ui.tab = tab;
    $$('[data-tab]', ui.root).forEach((b) => b.classList.toggle('on', b.getAttribute('data-tab') === tab));
    render();
  }

  function currentQuestions() {
    if (ui.lastScan && ui.lastScan.at > Date.now() - 30000) return ui.lastScan.questions;
    const qs = scan();
    ui.lastScan = { at: Date.now(), questions: qs };
    return qs;
  }

  function render() {
    if (!ui.body) return;
    if (ui.tab === 'fill') renderFill();
    else if (ui.tab === 'scan') renderScan();
    else if (ui.tab === 'tpl') renderTemplates();
    else renderSettings();
  }

  function kindTag(kind) {
    const map = { single: ['单选', ''], multi: ['多选', 'multi'], text: ['填空', 'text'], select: ['下拉', ''], matrix: ['矩阵', 'no'], unknown: ['未知', 'no'] };
    const pair = map[kind] || map.unknown;
    return '<span class="tag ' + pair[1] + '">' + pair[0] + '</span>';
  }

  function renderFill() {
    const qs = currentQuestions();
    const tpl = activeTemplate();
    const matched = qs.filter((q) => !q.unsupported && matchRule(q.titleNorm, tpl.rules)).length;
    const rows = ui.lastFill ? ui.lastFill.results : [];

    let html = '';
    html += '<div class="row">';
    html += '<button class="btn primary" data-act="fill">一键填充</button>';
    html += '<button class="btn" data-act="fillEmpty">只填空白题</button>';
    html += '</div>';
    html += '<div class="hint">识别 ' + qs.length + ' 道题 · 模板「' + esc(tpl.name) + '」' + (tpl.rules.length) + ' 条规则 · 可匹配 ' + matched + ' 道</div>';

    if (ui.lastFill) {
      const r = ui.lastFill;
      html += '<div class="hint" style="margin-top:6px">上次：成功 ' + r.ok + ' · 跳过 ' + r.skipped + ' · 失败 ' + r.failed + ' · 未匹配 ' + r.unmatched + '</div>';
    }

    if (rows.length) {
      html += '<div class="list">';
      for (const item of rows) {
        const cls = item.status === 'ok' ? 'ok' : item.status === 'fail' ? 'fail' : item.status === 'unmatched' ? 'unknown' : 'skip';
        html += '<div class="item ' + cls + '">';
        html += '<div class="t"><span class="seq">' + kindTag(item.q.kind) + '</span><span>' + esc(item.q.title).slice(0, 120) + '</span></div>';
        html += '<div class="m">' + esc(item.msg) + (item.rule ? ' · 规则「' + esc(item.rule.kw) + '」→「' + esc(item.rule.ans) + '」' : '') + '</div>';
        html += '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="hint" style="margin-top:10px">点「一键填充」后，这里会逐题显示成功/失败原因，绿色描边=成功，红色=失败。</div>';
    }

    ui.body.innerHTML = html;
  }

  function renderScan() {
    const qs = currentQuestions();
    const tpl = activeTemplate();
    ui.lastScan = { at: Date.now(), questions: qs };

    let html = '';
    html += '<div class="row"><button class="btn" data-act="scan">重新识别</button><span class="hint">共 ' + qs.length + ' 道题</span></div>';

    if (!qs.length) {
      html += '<div class="hint">没识别到题目。请确认这是问卷填写页（不是编辑页/预览页），需要的话滚动页面后再点「重新识别」。</div>';
      ui.body.innerHTML = html;
      return;
    }

    html += '<div class="list">';
    qs.forEach((q, i) => {
      const m = matchRule(q.titleNorm, tpl.rules);
      const cur = ui.scanAnswers[q.id] != null ? ui.scanAnswers[q.id] : m ? m.rule.ans : '';
      const opts = q.options.slice(0, 6).map((o) => esc(cleanText(o.label)).slice(0, 14)).join(' / ');
      html += '<div class="item' + (q.unsupported ? ' unknown' : '') + '">';
      html += '<div class="t"><span class="seq">' + (i + 1) + '.</span><span>' + esc(q.title).slice(0, 140) + '</span></div>';
      html += '<div class="m">' + kindTag(q.kind) + (q.unsupported ? ' ' + esc(q.unsupported) : '') + '</div>';
      if (opts) html += '<div class="opts">选项：' + opts + '</div>';
      if (q.kind !== 'matrix' && q.kind !== 'unknown') {
        html += '<input class="ans-input" data-qid="' + esc(q.id) + '" placeholder="答案：选项文字 / A / #2 / 随机；多选用 | 分隔" value="' + esc(cur) + '">';
      }
      html += '</div>';
    });
    html += '</div>';

    html += '<div class="row" style="margin-top:10px">';
    html += '<button class="btn primary" data-act="saveScanNew">存为新模板</button>';
    html += '<button class="btn" data-act="saveScanCurrent">覆盖当前模板</button>';
    html += '</div>';

    ui.body.innerHTML = html;
  }

  function renderTemplates() {
    const tpl = activeTemplate();
    let html = '';
    html += '<div class="row">';
    html += '<select class="tpl-sel" id="sfh-tpl-sel">';
    for (const t of state.templates) {
      html += '<option value="' + esc(t.id) + '"' + (t.id === state.activeId ? ' selected' : '') + '>' + esc(t.name) + '（' + t.rules.length + ' 条）</option>';
    }
    html += '</select>';
    html += '<button class="btn" data-act="newTpl">新建</button>';
    html += '<button class="btn" data-act="delTpl">删除</button>';
    html += '</div>';
    html += '<div class="hint">关键词多个用 | 分隔；匹配时忽略标点、空格、题号。</div>';
    html += '<div style="margin-top:8px">';
    for (const r of tpl.rules) {
      html += '<div class="rule">';
      html += '<input data-rule="' + esc(r.id) + '" data-field="kw" placeholder="题干关键词" value="' + esc(r.kw) + '">';
      html += '<input data-rule="' + esc(r.id) + '" data-field="ans" placeholder="答案" value="' + esc(r.ans) + '">';
      html += '<button class="del" data-act="delRule" data-rule="' + esc(r.id) + '" title="删除">×</button>';
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="row"><button class="btn" data-act="addRule">+ 加一条规则</button></div>';
    html += '<div class="row"><button class="btn" data-act="exportJson">导出 JSON</button><button class="btn" data-act="importJson">导入 JSON</button></div>';
    html += '<textarea class="jsonbox" id="sfh-json" hidden></textarea>';
    ui.body.innerHTML = html;
  }

  function renderSettings() {
    const s = state.settings;
    let html = '';
    html += '<label class="set"><input type="checkbox" data-set="onlyEmpty"' + (s.onlyEmpty ? ' checked' : '') + '> 默认只填空白题（已有答案的不覆盖）</label>';
    html += '<label class="set"><input type="checkbox" data-set="highlight"' + (s.highlight ? ' checked' : '') + '> 填充后描边高亮（绿=成功，红=失败）</label>';
    html += '<label class="set"><input type="checkbox" data-set="autoOpen"' + (s.autoOpen ? ' checked' : '') + '> 打开问卷时自动展开面板</label>';
    html += '<div class="row" style="margin-top:10px">填充间隔 <input class="num" type="number" min="0" max="2000" data-set="delayMin" value="' + s.delayMin + '"> ~ <input class="num" type="number" min="0" max="3000" data-set="delayMax" value="' + s.delayMax + '"> ms</div>';
    html += '<div class="row" style="margin-top:14px"><button class="btn" data-act="resetAll">清空全部数据（模板与设置）</button></div>';
    html += '<div class="hint" style="margin-top:10px">数据只保存在本机 Tampermonkey 里，不会上传。</div>';
    ui.body.innerHTML = html;
  }

  /* ---------------- 事件处理 ---------------- */

  function onInput(e) {
    const target = e.target;
    if (target.matches && target.matches('[data-rule]')) {
      const tpl = activeTemplate();
      const rule = tpl.rules.find((r) => r.id === target.getAttribute('data-rule'));
      if (rule) {
        rule[target.getAttribute('data-field')] = target.value;
        tpl.updatedAt = Date.now();
        saveSoon();
      }
      return;
    }
    if (target.matches && target.matches('.ans-input')) {
      ui.scanAnswers[target.getAttribute('data-qid')] = target.value;
    }
  }

  function onChange(e) {
    const target = e.target;
    if (target.matches && target.matches('[data-set]')) {
      const key = target.getAttribute('data-set');
      if (target.type === 'checkbox') state.settings[key] = target.checked;
      else state.settings[key] = Math.max(0, Number(target.value) || 0);
      save();
      return;
    }
    if (target.id === 'sfh-tpl-sel') {
      state.activeId = target.value;
      save();
      render();
    }
  }

  async function onClick(e) {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      setTab(tabBtn.getAttribute('data-tab'));
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    const act = btn.getAttribute('data-act');
    try {
      await runAction(act, btn);
    } catch (err) {
      console.error('[SFH]', err);
      toast('操作失败：' + (err && err.message ? err.message : err));
    }
  }

  async function runAction(act, btn) {
    if (act === 'close') {
      togglePanel(false);
      return;
    }
    if (act === 'fill' || act === 'fillEmpty') {
      btn.disabled = true;
      const before = btn.textContent;
      btn.textContent = '填充中…';
      try {
        ui.lastFill = await fillQuestions({ onlyEmpty: act === 'fillEmpty' || state.settings.onlyEmpty });
        const r = ui.lastFill;
        toast('填充完成：成功 ' + r.ok + ' / 共 ' + r.total + ' 道');
      } finally {
        btn.disabled = false;
        btn.textContent = before;
      }
      updateSite();
      render();
      return;
    }
    if (act === 'scan') {
      ui.lastScan = { at: Date.now(), questions: scan() };
      renderScan();
      return;
    }
    if (act === 'saveScanNew' || act === 'saveScanCurrent') {
      saveScanAsTemplate(act === 'saveScanNew');
      return;
    }
    if (act === 'newTpl') {
      const name = prompt('新模板名称', '模板 ' + (state.templates.length + 1));
      if (!name) return;
      const tpl = { id: uid('tpl'), name: String(name).slice(0, 40), updatedAt: Date.now(), rules: [] };
      state.templates.push(tpl);
      state.activeId = tpl.id;
      save();
      render();
      toast('已新建模板：' + tpl.name);
      return;
    }
    if (act === 'delTpl') {
      if (state.templates.length <= 1) {
        toast('至少保留一个模板');
        return;
      }
      const tpl = activeTemplate();
      if (!confirm('删除模板「' + tpl.name + '」？')) return;
      state.templates = state.templates.filter((t) => t.id !== tpl.id);
      state.activeId = state.templates[0].id;
      save();
      render();
      return;
    }
    if (act === 'addRule') {
      const tpl = activeTemplate();
      tpl.rules.push({ id: uid('r'), kw: '', ans: '' });
      tpl.updatedAt = Date.now();
      save();
      render();
      return;
    }
    if (act === 'delRule') {
      const tpl = activeTemplate();
      const rid = btn.getAttribute('data-rule');
      tpl.rules = tpl.rules.filter((r) => r.id !== rid);
      tpl.updatedAt = Date.now();
      save();
      render();
      return;
    }
    if (act === 'exportJson') {
      const box = ui.body.querySelector('#sfh-json');
      const data = JSON.stringify({ name: activeTemplate().name, rules: activeTemplate().rules }, null, 2);
      box.hidden = false;
      box.value = data;
      box.select();
      toast('已生成 JSON，可 Ctrl+C 复制');
      return;
    }
    if (act === 'importJson') {
      const box = ui.body.querySelector('#sfh-json');
      if (box.hidden) {
        box.hidden = false;
        box.value = '';
        box.focus();
        toast('把 JSON 粘进来，再点一次「导入 JSON」');
        return;
      }
      let data;
      try {
        data = JSON.parse(box.value);
      } catch (e) {
        toast('JSON 解析失败：' + e.message);
        return;
      }
      const rules = (Array.isArray(data) ? data : data.rules || []).map((r) => ({
        id: uid('r'),
        kw: String((r && r.kw) || ''),
        ans: String((r && r.ans) || ''),
      }));
      if (!rules.length) {
        toast('没有可导入的规则');
        return;
      }
      const tpl = activeTemplate();
      tpl.rules = rules;
      tpl.updatedAt = Date.now();
      if (data && data.name) tpl.name = String(data.name).slice(0, 40);
      save();
      render();
      toast('已导入 ' + rules.length + ' 条规则');
      return;
    }
    if (act === 'resetAll') {
      if (!confirm('清空全部模板和设置？此操作不可撤销。')) return;
      state = defaultState();
      save();
      ui.lastFill = null;
      ui.lastScan = null;
      ui.scanAnswers = {};
      render();
      toast('已重置');
    }
  }

  function saveScanAsTemplate(isNew) {
    const qs = currentQuestions();
    const answers = {};
    $$('.ans-input', ui.body).forEach((input) => {
      answers[input.getAttribute('data-qid')] = input.value;
    });

    const rules = [];
    for (const q of qs) {
      if (q.unsupported) continue;
      const ans = String(answers[q.id] || '').trim();
      if (!ans) continue;
      const kw = q.title.length > 60 ? q.title.slice(0, 60) : q.title;
      rules.push({ id: uid('r'), kw, ans });
    }
    if (!rules.length) {
      toast('至少给一道题填答案再保存');
      return;
    }

    let tpl;
    if (isNew) {
      const name = prompt('新模板名称', '问卷模板 ' + new Date().toLocaleDateString());
      if (!name) return;
      tpl = { id: uid('tpl'), name: String(name).slice(0, 40), updatedAt: Date.now(), rules };
      state.templates.push(tpl);
      state.activeId = tpl.id;
    } else {
      tpl = activeTemplate();
      tpl.rules = rules;
      tpl.updatedAt = Date.now();
    }
    save();
    setTab('tpl');
    toast('已保存 ' + rules.length + ' 条规则到「' + tpl.name + '」');
  }

  /* ------------------------------------------------------------------ *
   * 8. 启动
   * ------------------------------------------------------------------ */

  function boot() {
    if (document.getElementById('sfh-host')) return;
    buildUI();
    if (state.settings.autoOpen) togglePanel(true);

    if (typeof GM_registerMenuCommand === 'function') {
      try {
        GM_registerMenuCommand('打开问卷填表助手', () => togglePanel(true));
        GM_registerMenuCommand('一键填充当前问卷', async () => {
          ui.lastFill = await fillQuestions({});
          render();
          toast('填充完成：成功 ' + ui.lastFill.ok);
        });
      } catch (e) {
        /* ignore */
      }
    }

    console.info('[问卷填表助手] v' + VERSION + ' 已加载 · ' + pickAdapter().name);
  }

  function start() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  }

  // 供自测/高级用法使用（只读 + 手动调用）
  uw.__SFH__ = {
    version: VERSION,
    scan,
    fillAll: fillQuestions,
    getState: () => state,
    setState: (s) => {
      state = normalizeState(s);
      save();
      render();
    },
    getQuestions: () => scan(),
    matchRule,
    normKey,
    scoreOption,
    activeTemplate,
    adapters: ADAPTERS.map((a) => a.id),
    open: () => togglePanel(true),
  };

  start();
})();
