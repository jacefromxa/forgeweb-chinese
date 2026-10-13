// ==UserScript==
// @name         Forge Web 卡牌汉化 (Forge Web MTG Chinese Localization)
// @namespace    https://github.com/jacefromxa/forgeweb-chinese
// @version      1.3.0
// @description  为万智牌网页对战平台 forgeweb.app 原地汉化卡牌（支持战场地砖、手牌、堆叠、卡牌详情检查、悬浮异能说明小框、套牌列表与构筑等，支持传纪、鹏洛客、历险与房间牌），汉化数据源自大学院废墟 (mtgch.com)。采用 React-Safe 虚拟 DOM 零冲突架构，杜绝黑屏崩溃。
// @author       lieyanqzu & Antigravity
// @license      MIT
// @homepageURL  https://github.com/jacefromxa/forgeweb-chinese
// @supportURL   https://github.com/jacefromxa/forgeweb-chinese/issues
// @match        https://forgeweb.app/*
// @match        http://localhost:*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_openInTab
// @connect      mtgch.com
// @connect      api.scryfall.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================
  // 1. 常量与基础数据定义
  // ==========================================

  const SCRIPT_NAME = 'Forge Web 汉化';
  const SCRIPT_VERSION = '1.3.0';
  const API_SEARCH_URL = 'https://mtgch.com/api/v2/result';

  // 基本地与常见基础牌直接内置，极速零延迟
  const BUILTIN_CARDS = {
    'Plains': { name: '平原', type: '基本地～平原', text: '（{T}：加{W}。）' },
    'Island': { name: '海岛', type: '基本地～海岛', text: '（{T}：加{U}。）' },
    'Swamp': { name: '沼泽', type: '基本地～沼泽', text: '（{T}：加{B}。）' },
    'Mountain': { name: '山脉', type: '基本地～山脉', text: '（{T}：加{R}。）' },
    'Forest': { name: '树林', type: '基本地～树林', text: '（{T}：加{G}。）' },
    'Wastes': { name: '荒野', type: '基本地', text: '（{T}：加{C}。）' },
    'Snow-Covered Plains': { name: '覆雪平原', type: '雪境基本地～平原', text: '（{T}：加{W}。）' },
    'Snow-Covered Island': { name: '覆雪海岛', type: '雪境基本地～海岛', text: '（{T}：加{U}。）' },
    'Snow-Covered Swamp': { name: '覆雪沼泽', type: '雪境基本地～沼泽', text: '（{T}：加{B}。）' },
    'Snow-Covered Mountain': { name: '覆雪山脉', type: '雪境基本地～山脉', text: '（{T}：加{R}。）' },
    'Snow-Covered Forest': { name: '覆雪树林', type: '雪境基本地～树林', text: '（{T}：加{G}。）' },
    'Snow-Covered Wastes': { name: '覆雪荒野', type: '雪境基本地', text: '（{T}：加{C}。）' },
    'Face-down card': { name: '面朝下的牌', type: '生物', text: '（2/2无色未注名生物。）' },
    'Card': { name: '卡牌', type: '', text: '' }
  };

  // ==========================================
  // 2. 配置与持久化存储
  // ==========================================

  const Storage = {
    get(key, defaultVal) {
      if (typeof GM_getValue !== 'undefined') {
        try {
          return GM_getValue(key, defaultVal);
        } catch (e) {}
      }
      try {
        const v = localStorage.getItem(`forgeweb_${key}`);
        return v !== null ? JSON.parse(v) : defaultVal;
      } catch (e) {
        return defaultVal;
      }
    },
    set(key, val) {
      if (typeof GM_setValue !== 'undefined') {
        try {
          GM_setValue(key, val);
          return;
        } catch (e) {}
      }
      try {
        localStorage.setItem(`forgeweb_${key}`, JSON.stringify(val));
      } catch (e) {}
    }
  };

  const Settings = {
    enabled: Storage.get('enabled', true),
    bilingual: Storage.get('bilingual', false)
  };

  // 内存缓存
  const memoryCache = new Map();
  for (const [k, v] of Object.entries(BUILTIN_CARDS)) {
    memoryCache.set(k.toLowerCase(), v);
  }

  try {
    const savedCache = Storage.get('card_cache_v3', {});
    for (const [k, v] of Object.entries(savedCache)) {
      memoryCache.set(k.toLowerCase(), v);
    }
  } catch (e) {}

  function saveCacheToStorage() {
    try {
      const obj = {};
      let count = 0;
      for (const [k, v] of memoryCache.entries()) {
        if (!BUILTIN_CARDS[k]) {
          obj[k] = v;
          count++;
          if (count > 2500) break;
        }
      }
      Storage.set('card_cache_v3', obj);
    } catch (e) {}
  }

  // ==========================================
  // 3. 网络请求封装与批量查询
  // ==========================================

  function httpRequest(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        try {
          GM_xmlhttpRequest({
            method: 'GET',
            url,
            headers: { 'Accept': 'application/json' },
            onload: (res) => {
              if (res.status >= 200 && res.status < 300) {
                try {
                  resolve(JSON.parse(res.responseText));
                } catch (err) {
                  reject(err);
                }
              } else {
                reject(new Error(`HTTP ${res.status}: ${res.statusText}`));
              }
            },
            onerror: reject,
            ontimeout: () => reject(new Error('Request timed out'))
          });
          return;
        } catch (e) {}
      }

      fetch(url)
        .then(res => res.json())
        .then(resolve)
        .catch(reject);
    });
  }

  const pendingQueue = new Set();
  const activeRequests = new Map();
  let batchTimer = null;

  async function fetchCardData(name) {
    const cleanName = cleanCardName(name);
    if (!cleanName || cleanName === 'Card' || cleanName === 'Face-down card') return null;
    const key = cleanName.toLowerCase();

    if (memoryCache.has(key)) {
      return memoryCache.get(key);
    }

    if (activeRequests.has(key)) {
      return activeRequests.get(key);
    }

    const promise = new Promise((resolve) => {
      pendingQueue.add({ name: cleanName, key, resolve });
      scheduleBatch();
    });

    activeRequests.set(key, promise);
    return promise;
  }

  function scheduleBatch() {
    if (batchTimer) return;
    batchTimer = setTimeout(() => {
      batchTimer = null;
      processBatch();
    }, 80);
  }

  async function processBatch() {
    if (pendingQueue.size === 0) return;

    const items = Array.from(pendingQueue);
    pendingQueue.clear();

    const BATCH_SIZE = 10;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const chunk = items.slice(i, i + BATCH_SIZE);
      const queryParts = chunk.map(item => `!"${item.name.replace(/"/g, '')}"`);
      const q = queryParts.join(' or ');
      const url = `${API_SEARCH_URL}?q=${encodeURIComponent(q)}&unique=oracle_id&include_extras=true`;

      try {
        const data = await httpRequest(url);
        const cardList = data.items || [];

        for (const item of chunk) {
          const matched = findBestCardMatch(item.name, cardList);
          if (matched) {
            const parsed = parseApiCard(matched, item.name);
            memoryCache.set(item.key, parsed);
            activeRequests.delete(item.key);
            item.resolve(parsed);
          } else {
            activeRequests.delete(item.key);
            item.resolve(null);
          }
        }
      } catch (err) {
        for (const item of chunk) {
          try {
            const singleUrl = `${API_SEARCH_URL}?q=!%22${encodeURIComponent(item.name)}%22&unique=oracle_id&include_extras=true`;
            const data = await httpRequest(singleUrl);
            const matched = findBestCardMatch(item.name, data.items || []);
            if (matched) {
              const parsed = parseApiCard(matched, item.name);
              memoryCache.set(item.key, parsed);
              item.resolve(parsed);
            } else {
              item.resolve(null);
            }
          } catch (e) {
            item.resolve(null);
          } finally {
            activeRequests.delete(item.key);
          }
        }
      }
    }

    saveCacheToStorage();
    requestAnimationFrame(() => applyTranslationsToPage());
  }

  function findBestCardMatch(name, items) {
    if (!items || items.length === 0) return null;
    const lower = name.toLowerCase();

    for (const it of items) {
      if (it.name?.toLowerCase() === lower || it.face_name?.toLowerCase() === lower) {
        return it;
      }
    }
    for (const it of items) {
      if (it.name && it.name.toLowerCase().startsWith(`${lower} //`)) {
        return it;
      }
      if (it.other_faces) {
        for (const of of it.other_faces) {
          if (of.name?.toLowerCase() === lower || of.face_name?.toLowerCase() === lower) {
            return it;
          }
        }
      }
    }
    for (const it of items) {
      if (it.name?.toLowerCase().includes(lower)) {
        return it;
      }
    }
    return items[0];
  }

  function parseApiCard(cardData, originalQueryName) {
    const zhsOracle = cardData.zhs_oracle || {};
    const zhsCard = cardData.zhs_card || {};

    const mainZhName = zhsOracle.name || zhsCard.name || cardData.name;
    const faceZhName = zhsOracle.face_name || zhsCard.face_name || mainZhName;
    const typeLine = zhsOracle.type_line || zhsCard.type_line || cardData.type_line || '';
    const oracleText = zhsOracle.oracle_text || zhsCard.printed_text || cardData.oracle_text || '';

    const faces = [];
    faces.push({
      name: faceZhName || mainZhName,
      typeLine,
      oracleText
    });

    if (cardData.other_faces && cardData.other_faces.length > 0) {
      for (const of of cardData.other_faces) {
        const ofOracle = of.zhs_oracle || {};
        const ofCard = of.zhs_card || {};
        faces.push({
          name: ofOracle.face_name || ofOracle.name || of.name,
          typeLine: ofOracle.type_line || ofCard.type_line || of.type_line || '',
          oracleText: ofOracle.oracle_text || ofCard.printed_text || of.oracle_text || ''
        });
      }
    }

    return {
      name: mainZhName,
      faceName: faceZhName,
      typeLine,
      oracleText,
      faces,
      layout: cardData.layout,
      scryfallId: cardData.scryfall_id,
      setCode: cardData.set,
      collectorNumber: cardData.collector_number
    };
  }

  function cleanCardName(name) {
    if (!name) return '';
    return name.trim();
  }

  // ==========================================
  // 4. 法术力符号与规则文本格式化
  // ==========================================

  const MANA_SYMBOL_MAP = {
    't': 'tap',
    'q': 'untap',
    'x': 'x',
    'y': 'y',
    'z': 'z',
    's': 's',
    'e': 'e',
    'c': 'c',
    'w': 'w',
    'u': 'u',
    'b': 'b',
    'r': 'r',
    'g': 'g'
  };

  function formatManaSymbols(rawText) {
    if (!rawText) return '';

    let text = rawText.replace(/o([0-9wubrgctqxys])/gi, '{$1}');
    text = text.replace(/\\n/g, '\n');

    text = text.replace(/\{([^}]+)\}/g, (match, sym) => {
      const s = sym.trim();
      const lower = s.toLowerCase();
      let iconClass = '';

      if (MANA_SYMBOL_MAP[lower]) {
        iconClass = `ms-${MANA_SYMBOL_MAP[lower]}`;
      } else if (/^\d+$/.test(s)) {
        iconClass = `ms-${s}`;
      } else if (lower.includes('/')) {
        const parts = lower.split('/');
        iconClass = `ms-${parts.join('')}`;
      } else {
        iconClass = `ms-${lower}`;
      }

      return `<i class="ms ms-cost ${iconClass} _inlineMana_jzxwn_561" aria-label="${s}"></i>`;
    });

    const paragraphs = text.split(/\n+/);
    if (paragraphs.length > 1) {
      return paragraphs.map(p => p.trim()).filter(Boolean).map(p => `<p>${p}</p>`).join('');
    }
    return text;
  }

  function getDisplayName(data, origName) {
    const zh = data.faceName || data.name;
    if (Settings.bilingual && origName && origName !== zh) {
      return `${zh} (${origName})`;
    }
    return zh;
  }

  // ==========================================
  // 5. React-Safe 虚拟 DOM 零冲突核心更新机制
  // ==========================================

  /**
   * 安全文本节点更新：
   * 直接修改已有 Text 节点的 nodeValue，绝不销毁节点，绝不使用 textContent 重新生成节点。
   * 这保证了 React 虚拟 DOM 树（Fiber）持有的 stateNode 引用始终有效，杜绝 removeChild 报错！
   */
  function setSafeText(el, newText) {
    if (!el || !newText) return;

    // 寻找现有的 Text 节点
    let textNode = null;
    for (let i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === Node.TEXT_NODE) {
        textNode = el.childNodes[i];
        break;
      }
    }

    if (textNode) {
      if (!el.dataset.origText) {
        el.dataset.origText = textNode.nodeValue;
      }
      const target = Settings.enabled ? newText : el.dataset.origText;
      if (textNode.nodeValue !== target) {
        textNode.nodeValue = target;
      }
    } else if (el.childNodes.length === 0) {
      if (!el.dataset.origText) {
        el.dataset.origText = '';
      }
      const target = Settings.enabled ? newText : el.dataset.origText;
      el.appendChild(document.createTextNode(target));
    }
  }

  /**
   * 规则叙述安全覆层机制：
   * 绝不破坏、删除或替换 React 渲染的 rulesText 内部子节点（包括法术力图标和文本）。
   * 仅通过 display: none 隐藏原节点，并在父容器 rulesBox 中附加独立的中文渲染层。
   * 即使卡牌被施放、移入坟场或卸载，React 也能正常执行 commitDeletion，零报错！
   */
  function setSafeRules(rulesBoxEl, zhHtml) {
    if (!rulesBoxEl) return;
    const origRules = rulesBoxEl.querySelector('[class*="rulesText_jzxwn"]:not(.forgeweb-zh-rules)');
    if (!origRules) return;

    let zhEl = rulesBoxEl.querySelector('.forgeweb-zh-rules');

    if (Settings.enabled && zhHtml) {
      if (origRules.style.display !== 'none') {
        origRules.style.display = 'none';
      }

      if (!zhEl) {
        zhEl = document.createElement('div');
        zhEl.className = `${origRules.className} forgeweb-zh-rules`;
        rulesBoxEl.appendChild(zhEl);
      }
      if (zhEl.dataset.currentHtml !== zhHtml) {
        zhEl.dataset.currentHtml = zhHtml;
        zhEl.innerHTML = zhHtml;
      }
      if (zhEl.style.display !== '') {
        zhEl.style.display = '';
      }
    } else {
      if (origRules.style.display === 'none') {
        origRules.style.display = '';
      }
      if (zhEl && zhEl.style.display !== 'none') {
        zhEl.style.display = 'none';
      }
    }
  }

  function setSafeFaceRules(panel, zhHtml) {
    const origP = panel.querySelector('p:not(.forgeweb-zh-rules)');
    if (!origP) return;
    let zhP = panel.querySelector('p.forgeweb-zh-rules');
    if (Settings.enabled && zhHtml) {
      if (origP.style.display !== 'none') origP.style.display = 'none';
      if (!zhP) {
        zhP = document.createElement('p');
        zhP.className = `${origP.className} forgeweb-zh-rules`;
        origP.parentNode.insertBefore(zhP, origP.nextSibling);
      }
      if (zhP.dataset.currentHtml !== zhHtml) {
        zhP.dataset.currentHtml = zhHtml;
        zhP.innerHTML = zhHtml;
      }
      if (zhP.style.display !== '') zhP.style.display = '';
    } else {
      if (origP.style.display === 'none') origP.style.display = '';
      if (zhP && zhP.style.display !== 'none') zhP.style.display = 'none';
    }
  }

  function applyCardTranslation(cardEl, data) {
    if (!cardEl || !data) return;
    // 坚决避开 Forge Web 内部状态追踪节点
    if (cardEl.closest('[aria-hidden="true"]')) return;

    try {
      // --- A. 大卡牌 / 手牌 / 预览视图 (_card_jzxwn_1) ---
      const innerCard = cardEl.matches('[class*="card_jzxwn"]') ? cardEl : cardEl.querySelector('[class*="card_jzxwn"]');
      if (innerCard) {
        // 1. 卡牌名称 (_cardName_jzxwn_103)
        const nameEl = innerCard.querySelector('[class*="cardName_jzxwn"]');
        if (nameEl) {
          setSafeText(nameEl, getDisplayName(data, nameEl.dataset.origText || nameEl.textContent));
        }

        // 2. 类别栏 (_typeLine_jzxwn_62)
        const typeSpan = innerCard.querySelector('[class*="typeLine_jzxwn"] > span');
        if (typeSpan && data.typeLine) {
          setSafeText(typeSpan, data.typeLine);
        }

        // 3. 规则叙述框 (使用安全覆层)
        const rulesBox = innerCard.querySelector('[class*="rulesBox_jzxwn"]');
        if (rulesBox && data.oracleText) {
          setSafeRules(rulesBox, formatManaSymbols(data.oracleText));
        }

        // 4. 传纪结构 (Saga) - 提示文本
        const reminderEl = innerCard.querySelector('[class*="reminder_jzxwn"]');
        if (reminderEl && data.oracleText) {
          const reminderMatch = data.oracleText.match(/（[^）]+）|\([^)]+\)/);
          if (reminderMatch) {
            setSafeText(reminderEl, reminderMatch[0]);
          }
        }

        // 5. 传纪章节列表 / 鹏洛客忠诚异能列表 (使用安全覆层)
        const sectionItems = innerCard.querySelectorAll('[class*="sectionList_jzxwn"] li, [class*="abilityBox_jzxwn"] li');
        if (sectionItems.length > 0 && data.oracleText) {
          const lines = data.oracleText.split(/\n+/).map(l => l.trim()).filter(Boolean);
          const abilityLines = lines.filter(l => !/^（.*）$|^\(.*?\)$/.test(l));

          sectionItems.forEach((li, idx) => {
            const origSpan = li.querySelector('span:last-child:not(.forgeweb-zh-ability)');
            if (origSpan && idx < abilityLines.length) {
              let line = abilityLines[idx];
              line = line.replace(/^(I+|IV|V|VI)\s*[—–-]\s*/i, '');
              line = line.replace(/^[+−-]?\d+[:：]\s*/, '');

              let zhSpan = li.querySelector('.forgeweb-zh-ability');
              if (Settings.enabled && line) {
                if (origSpan.style.display !== 'none') origSpan.style.display = 'none';
                if (!zhSpan) {
                  zhSpan = document.createElement('span');
                  zhSpan.className = 'forgeweb-zh-ability';
                  li.appendChild(zhSpan);
                }
                const costEl = origSpan.querySelector('b');
                const costHtml = costEl ? costEl.outerHTML : '';
                const fullHtml = costHtml + formatManaSymbols(line);
                if (zhSpan.dataset.currentHtml !== fullHtml) {
                  zhSpan.dataset.currentHtml = fullHtml;
                  zhSpan.innerHTML = fullHtml;
                }
                if (zhSpan.style.display !== '') zhSpan.style.display = '';
              } else {
                if (origSpan.style.display === 'none') origSpan.style.display = '';
                if (zhSpan && zhSpan.style.display !== 'none') zhSpan.style.display = 'none';
              }
            }
          });
        }

        // 6. 分割牌 / 双面牌面 (_facePanel_jzxwn_403)
        const facePanels = innerCard.querySelectorAll('[class*="facePanel_jzxwn"]');
        if (facePanels.length > 0 && data.faces && data.faces.length > 1) {
          facePanels.forEach((panel, idx) => {
            const faceData = data.faces[idx];
            if (!faceData) return;

            const smallType = panel.querySelector('small');
            if (smallType && faceData.typeLine) {
              setSafeText(smallType, faceData.typeLine);
            }

            if (faceData.oracleText) {
              setSafeFaceRules(panel, formatManaSymbols(faceData.oracleText));
            }
          });
        }

        // 7. 双面牌背面提示 (_faceCue_jzxwn_506)
        const faceCue = innerCard.querySelector('[class*="faceCue_jzxwn"]');
        if (faceCue && data.faces && data.faces.length > 1) {
          const otherFace = data.faces[1];
          const strongEl = faceCue.querySelector('strong');
          const smallEl = faceCue.querySelector('small');
          if (strongEl && otherFace.name) {
            setSafeText(strongEl, otherFace.name);
          }
          if (smallEl && otherFace.typeLine) {
            setSafeText(smallEl, otherFace.typeLine);
          }
        }
      }

      // --- B. 战场地砖 / 图标视图 (_tile_y09se_298) ---
      const tileNameEl = cardEl.querySelector('[class*="tileName_y09se"]');
      if (tileNameEl) {
        setSafeText(tileNameEl, getDisplayName(data, tileNameEl.dataset.origText || tileNameEl.textContent));
      }

      // --- C. 简约框式卡牌 (Frame View) ---
      const frameNameEl = cardEl.querySelector('[class*="cardHead_y09se"] [class*="name_y09se"]');
      if (frameNameEl) {
        setSafeText(frameNameEl, getDisplayName(data, frameNameEl.dataset.origText || frameNameEl.textContent));
      }

      const frameTypeEl = cardEl.querySelector('[class*="typeLine_y09se"]');
      if (frameTypeEl && data.typeLine) {
        setSafeText(frameTypeEl, data.typeLine);
      }

      const frameRulesEl = cardEl.querySelector('[class*="rulesText_y09se"]');
      if (frameRulesEl && data.typeLine) {
        setSafeText(frameRulesEl, data.typeLine);
      }

      cardEl.dataset.forgewebI18n = Settings.enabled ? 'zh' : 'en';
    } catch (err) {}
  }

  function applyListEntryTranslation(entryEl, data) {
    if (!entryEl || !data) return;
    try {
      setSafeText(entryEl, getDisplayName(data, entryEl.dataset.origText || entryEl.textContent));
      entryEl.dataset.forgewebI18n = Settings.enabled ? 'zh' : 'en';
    } catch (e) {}
  }

  // ==========================================
  // 5.5 异能机制说明框汉化 (Card Mechanics & Keywords)
  // ==========================================

  const MECHANIC_TITLES = {
    'flying': '飞行',
    'reach': '延势',
    'trample': '践踏',
    'first strike': '先攻',
    'double strike': '连击',
    'deathtouch': '死触',
    'lifelink': '系命',
    'haste': '敏捷',
    'vigilance': '警戒',
    'menace': '威慑',
    'defender': '守军',
    'flash': '闪现',
    'hexproof': '辟邪',
    'shroud': '帷幕',
    'indestructible': '不灭',
    'morph': '变身',
    'megamorph': '巨变',
    'disguise': '伪装',
    'cloak': '遮掩',
    'prowess': '灵技',
    'ward': '守护',
    'scry': '占卜',
    'surveil': '刺探',
    'cycling': '循环',
    'typecycling': '类别循环',
    'landcycling': '地循环',
    'basic landcycling': '基本地循环',
    'flashback': '返照',
    'kicker': '增幅',
    'multikicker': '多重增幅',
    'convoke': '召集',
    'delve': '掘穴',
    'mutate': '合流',
    'ninjutsu': '忍术',
    'commander ninjutsu': '指挥官忍术',
    'proliferate': '增殖',
    'explore': '探险',
    'connive': '谋略',
    'amass': '屯兵',
    'bargain': '核契',
    'foretell': '预言',
    'dash': '疾冲',
    'decayed': '腐朽',
    'toxic': '毒性',
    'poisonous': '有毒',
    'infect': '感染',
    'annihilator': '灭绝',
    'bushido': '武士道',
    'soulbond': '魂系',
    'extort': '敲诈',
    'evolve': '进化',
    'unleash': '脱缰',
    'dredge': '发掘',
    'storm': '风暴',
    'buyback': '购回',
    'madness': '疯魔',
    'echo': '返响',
    'fading': '衰退',
    'vanishing': '消逝',
    'persist': '留存',
    'undying': '不死',
    'modular': '接力',
    'bloodthirst': '渴血',
    'devour': '吞噬',
    'exalted': '颂圣',
    'miracle': '奇迹',
    'overload': '超载',
    'cipher': '暗码',
    'battalion': '协战',
    'bestow': '授业',
    'tribute': '奉献',
    'inspired': '感召',
    'constellation': '星彩',
    'outlast': '延驻',
    'exploit': '榨取',
    'renown': '声威',
    'awaken': '醒转',
    'devoid': '虚无',
    'ingest': '摄食',
    'cohort': '同袍',
    'surge': '潮涌',
    'skulk': '潜行',
    'emerge': '现身',
    'escalate': '升级',
    'fabricate': '装配',
    'improvise': '拼凑',
    'aftermath': '余响',
    'embalm': '遗存',
    'eternalize': '永生',
    'afflict': '残虐',
    'ascend': '登殿',
    'jump-start': '腾跃',
    'mentor': '训导',
    'riot': '暴动',
    'spectacle': '盛戏',
    'afterlife': '后嗣',
    'escape': '脱逸',
    'companion': '行侣',
    'boast': '夸耀',
    'daybound': '昼形',
    'nightbound': '夜形',
    'disturb': '惊扰',
    'cleave': '劈开',
    'training': '训练',
    'casualty': '倾轧',
    'blitz': '急袭',
    'enlist': '征集',
    'read ahead': '跳读',
    'prototype': '试做',
    'for mirrodin!': '为了秘罗地！',
    'corrupted': '腐化',
    'backup': '援军',
    'incubate': '玄奥',
    'craft': '制作',
    'discover': '发现',
    'collect evidence': '搜集证据',
    'plot': '谋划',
    'spree': '肆虐',
    'saddle': '备鞍',
    'freerunning': '跑酷',
    'gift': '赠礼',
    'offspring': '幼苗',
    'forage': '觅食',
    'valiant': '英勇',
    'expend': '耗费',
    'impending': '降临',
    'room': '房间',
    'eerie': '怪诞',
    'survival': '生还',
    'equip': '佩带',
    'crew': '搭载',
    'level up': '升级',
    'cascade': '倾曳',
    'hideaway': '掩蔽',
    'chant': '唱颂',
    'phasing': '跃离',
    'shadow': '暗影',
    'horsemanship': '马术',
    'flanking': '侧击',
    'fear': '威吓',
    'intimidate': '慑人',
    'landwalk': '行地',
    'forestwalk': '行林',
    'islandwalk': '行岛',
    'swampwalk': '行沼',
    'mountainwalk': '行山',
    'plainswalk': '行平原'
  };

  const MECHANIC_TITLE_PATTERNS = [
    [/^Ward\s+(.+)$/i, (t) => `守护 ${t.match(/^Ward\s+(.+)$/i)[1]}`],
    [/^Scry\s+(\d+)$/i, (t) => `占卜 ${t.match(/^Scry\s+(\d+)$/i)[1]}`],
    [/^Surveil\s+(\d+)$/i, (t) => `刺探 ${t.match(/^Surveil\s+(\d+)$/i)[1]}`],
    [/^Toxic\s+(\d+)$/i, (t) => `毒性 ${t.match(/^Toxic\s+(\d+)$/i)[1]}`],
    [/^Annihilator\s+(\d+)$/i, (t) => `灭绝 ${t.match(/^Annihilator\s+(\d+)$/i)[1]}`],
    [/^Bushido\s+(\d+)$/i, (t) => `武士道 ${t.match(/^Bushido\s+(\d+)$/i)[1]}`],
    [/^Crew\s+(\d+)$/i, (t) => `搭载 ${t.match(/^Crew\s+(\d+)$/i)[1]}`],
    [/^Saddle\s+(\d+)$/i, (t) => `备鞍 ${t.match(/^Saddle\s+(\d+)$/i)[1]}`],
    [/^Equip\s+(.+)$/i, (t) => `佩带 ${t.match(/^Equip\s+(.+)$/i)[1]}`],
    [/^Kicker\s+(.+)$/i, (t) => `增幅 ${t.match(/^Kicker\s+(.+)$/i)[1]}`],
    [/^Multikicker\s+(.+)$/i, (t) => `多重增幅 ${t.match(/^Multikicker\s+(.+)$/i)[1]}`],
    [/^Cycling\s+(.+)$/i, (t) => `循环 ${t.match(/^Cycling\s+(.+)$/i)[1]}`],
    [/^Typecycling\s+(.+)$/i, (t) => `类别循环 ${t.match(/^Typecycling\s+(.+)$/i)[1]}`],
    [/^Landcycling\s+(.+)$/i, (t) => `地循环 ${t.match(/^Landcycling\s+(.+)$/i)[1]}`],
    [/^Basic landcycling\s+(.+)$/i, (t) => `基本地循环 ${t.match(/^Basic landcycling\s+(.+)$/i)[1]}`],
    [/^Discover\s+(\d+)$/i, (t) => `发现 ${t.match(/^Discover\s+(\d+)$/i)[1]}`],
    [/^Expend\s+(\d+)$/i, (t) => `耗费 ${t.match(/^Expend\s+(\d+)$/i)[1]}`],
    [/^Backup\s+(\d+)$/i, (t) => `援军 ${t.match(/^Backup\s+(\d+)$/i)[1]}`],
    [/^Incubate\s+(\d+)$/i, (t) => `玄奥 ${t.match(/^Incubate\s+(\d+)$/i)[1]}`],
    [/^Collect evidence\s+(\d+)$/i, (t) => `搜集证据 ${t.match(/^Collect evidence\s+(\d+)$/i)[1]}`],
    [/^Amass\s+(.+)\s+(\d+)$/i, (t) => `屯兵 ${t.match(/^Amass\s+(.+)\s+(\d+)$/i)[1]} ${t.match(/^Amass\s+(.+)\s+(\d+)$/i)[2]}`],
    [/^Amass\s+(\d+)$/i, (t) => `屯兵 ${t.match(/^Amass\s+(\d+)$/i)[1]}`],
    [/^Level up\s+(.+)$/i, (t) => `升级 ${t.match(/^Level up\s+(.+)$/i)[1]}`],
    [/^Impending\s+(\d+)\s*[—–-]\s*(.+)$/i, (t) => `降临 ${t.match(/^Impending\s+(\d+)\s*[—–-]\s*(.+)$/i)[1]}—${t.match(/^Impending\s+(\d+)\s*[—–-]\s*(.+)$/i)[2]}`],
    [/^Freerunning\s+(.+)$/i, (t) => `跑酷 ${t.match(/^Freerunning\s+(.+)$/i)[1]}`],
    [/^Offspring\s+(.+)$/i, (t) => `幼苗 ${t.match(/^Offspring\s+(.+)$/i)[1]}`],
    [/^Casualty\s+(\d+)$/i, (t) => `倾轧 ${t.match(/^Casualty\s+(\d+)$/i)[1]}`],
    [/^Blitz\s+(.+)$/i, (t) => `急袭 ${t.match(/^Blitz\s+(.+)$/i)[1]}`],
    [/^Prototype\s+(.+)$/i, (t) => `试做 ${t.match(/^Prototype\s+(.+)$/i)[1]}`],
    [/^Plot\s+(.+)$/i, (t) => `谋划 ${t.match(/^Plot\s+(.+)$/i)[1]}`],
    [/^Boast\s+(.+)$/i, (t) => `夸耀 ${t.match(/^Boast\s+(.+)$/i)[1]}`],
    [/^Escape\s+(.+)$/i, (t) => `脱逸 ${t.match(/^Escape\s+(.+)$/i)[1]}`],
    [/^Afflict\s+(\d+)$/i, (t) => `残虐 ${t.match(/^Afflict\s+(\d+)$/i)[1]}`],
    [/^Fading\s+(\d+)$/i, (t) => `衰退 ${t.match(/^Fading\s+(\d+)$/i)[1]}`],
    [/^Vanishing\s+(\d+)$/i, (t) => `消逝 ${t.match(/^Vanishing\s+(\d+)$/i)[1]}`],
    [/^Modular\s+(\d+)$/i, (t) => `接力 ${t.match(/^Modular\s+(\d+)$/i)[1]}`],
    [/^Bloodthirst\s+(\d+)$/i, (t) => `渴血 ${t.match(/^Bloodthirst\s+(\d+)$/i)[1]}`],
    [/^Devour\s+(\d+)$/i, (t) => `吞噬 ${t.match(/^Devour\s+(\d+)$/i)[1]}`],
    [/^Spectacle\s+(.+)$/i, (t) => `盛戏 ${t.match(/^Spectacle\s+(.+)$/i)[1]}`],
    [/^Afterlife\s+(\d+)$/i, (t) => `后嗣 ${t.match(/^Afterlife\s+(\d+)$/i)[1]}`],
    [/^Echo\s+(.+)$/i, (t) => `返响 ${t.match(/^Echo\s+(.+)$/i)[1]}`],
    [/^Suspend\s+(\d+)\s*[—–-]\s*(.+)$/i, (t) => `延缓 ${t.match(/^Suspend\s+(\d+)\s*[—–-]\s*(.+)$/i)[1]}—${t.match(/^Suspend\s+(\d+)\s*[—–-]\s*(.+)$/i)[2]}`],
    [/^Miracle\s+(.+)$/i, (t) => `奇迹 ${t.match(/^Miracle\s+(.+)$/i)[1]}`],
    [/^Overload\s+(.+)$/i, (t) => `超载 ${t.match(/^Overload\s+(.+)$/i)[1]}`],
    [/^Flashback\s+(.+)$/i, (t) => `返照 ${t.match(/^Flashback\s+(.+)$/i)[1]}`],
    [/^Morph\s+(.+)$/i, (t) => `变身 ${t.match(/^Morph\s+(.+)$/i)[1]}`],
    [/^Megamorph\s+(.+)$/i, (t) => `巨变 ${t.match(/^Megamorph\s+(.+)$/i)[1]}`],
    [/^Disguise\s+(.+)$/i, (t) => `伪装 ${t.match(/^Disguise\s+(.+)$/i)[1]}`],
    [/^Unearth\s+(.+)$/i, (t) => `破土 ${t.match(/^Unearth\s+(.+)$/i)[1]}`],
    [/^Ninjutsu\s+(.+)$/i, (t) => `忍术 ${t.match(/^Ninjutsu\s+(.+)$/i)[1]}`],
    [/^Commander ninjutsu\s+(.+)$/i, (t) => `指挥官忍术 ${t.match(/^Commander ninjutsu\s+(.+)$/i)[1]}`],
    [/^Transmute\s+(.+)$/i, (t) => `易质 ${t.match(/^Transmute\s+(.+)$/i)[1]}`],
    [/^Replicate\s+(.+)$/i, (t) => `覆诵 ${t.match(/^Replicate\s+(.+)$/i)[1]}`],
    [/^Recover\s+(.+)$/i, (t) => `复原 ${t.match(/^Recover\s+(.+)$/i)[1]}`],
    [/^Ripple\s+(\d+)$/i, (t) => `涟漪 ${t.match(/^Ripple\s+(\d+)$/i)[1]}`],
    [/^Graft\s+(\d+)$/i, (t) => `接枝 ${t.match(/^Graft\s+(\d+)$/i)[1]}`],
    [/^Dredge\s+(\d+)$/i, (t) => `发掘 ${t.match(/^Dredge\s+(\d+)$/i)[1]}`],
    [/^Buyback\s+(.+)$/i, (t) => `购回 ${t.match(/^Buyback\s+(.+)$/i)[1]}`],
    [/^Madness\s+(.+)$/i, (t) => `疯魔 ${t.match(/^Madness\s+(.+)$/i)[1]}`],
    [/^Outlast\s+(.+)$/i, (t) => `延驻 ${t.match(/^Outlast\s+(.+)$/i)[1]}`],
    [/^Dash\s+(.+)$/i, (t) => `疾冲 ${t.match(/^Dash\s+(.+)$/i)[1]}`],
    [/^Renown\s+(\d+)$/i, (t) => `声威 ${t.match(/^Renown\s+(\d+)$/i)[1]}`],
    [/^Awaken\s+(\d+)\s*[—–-]\s*(.+)$/i, (t) => `醒转 ${t.match(/^Awaken\s+(\d+)\s*[—–-]\s*(.+)$/i)[1]}—${t.match(/^Awaken\s+(\d+)\s*[—–-]\s*(.+)$/i)[2]}`],
    [/^Surge\s+(.+)$/i, (t) => `潮涌 ${t.match(/^Surge\s+(.+)$/i)[1]}`],
    [/^Emerge\s+(.+)$/i, (t) => `现身 ${t.match(/^Emerge\s+(.+)$/i)[1]}`],
    [/^Escalate\s+(.+)$/i, (t) => `升级 ${t.match(/^Escalate\s+(.+)$/i)[1]}`],
    [/^Fabricate\s+(\d+)$/i, (t) => `装配 ${t.match(/^Fabricate\s+(\d+)$/i)[1]}`],
    [/^Embalm\s+(.+)$/i, (t) => `遗存 ${t.match(/^Embalm\s+(.+)$/i)[1]}`],
    [/^Eternalize\s+(.+)$/i, (t) => `永生 ${t.match(/^Eternalize\s+(.+)$/i)[1]}`],
    [/^Cleave\s+(.+)$/i, (t) => `劈开 ${t.match(/^Cleave\s+(.+)$/i)[1]}`],
    [/^Disturb\s+(.+)$/i, (t) => `惊扰 ${t.match(/^Disturb\s+(.+)$/i)[1]}`],
    [/^Foretell\s+(.+)$/i, (t) => `预言 ${t.match(/^Foretell\s+(.+)$/i)[1]}`],
    [/^Hideaway\s+(\d+)$/i, (t) => `掩蔽 ${t.match(/^Hideaway\s+(\d+)$/i)[1]}`],
    [/^Poisonous\s+(\d+)$/i, (t) => `有毒 ${t.match(/^Poisonous\s+(\d+)$/i)[1]}`]
  ];

  const MECHANIC_DESCRIPTIONS = [
    [/blocked except by creatures with flying and\/or reach/i, '此生物只能被具飞行或延势异能的生物阻挡。'],
    [/can block creatures with flying/i, '此生物能阻挡具飞行异能的生物。'],
    [/excess combat damage to the player or planeswalker/i, '此生物能对所攻击的牌手或鹏洛客造成过量战斗伤害。'],
    [/deals combat damage before creatures without first strike/i, '此生物能在未具先攻异能的生物之前造成战斗伤害。'],
    [/deals combat damage twice/i, '此生物能造成两次战斗伤害（分别在先攻战斗伤害步骤与普通战斗伤害步骤）。'],
    [/amount of damage this deals to a creature is lethal damage/i, '此生物对生物造成的任意数量伤害都是致命伤害。'],
    [/Damage dealt by this creature also causes you to gain that much life/i, '此生物所造成的伤害会使你获得等量的生命。'],
    [/can attack and (?:\{T\}|tap) as soon as it comes under your control/i, '此生物一受你操控即可攻击与{T}。'],
    [/Attacking doesn't cause this creature to tap/i, '此生物攻击时不需横置。'],
    [/can't be blocked except by two or more creatures/i, '此生物只能被两个或更多生物阻挡。'],
    [/This creature can't attack/i, '此生物不能攻击。'],
    [/any time you could cast an instant/i, '你可以于你能够施放瞬间的时机下施放此咒语。'],
    [/can't be the target of spells or abilities your opponents control/i, '此永久物不能成为由对手所操控之咒语或异能的目标。'],
    [/can't be the target of spells or abilities/i, '此永久物不能成为任何咒语或异能的目标。'],
    [/don't destroy this, and lethal damage doesn't either/i, '标明「消灭」的效应不能消灭它，致命伤害也不能。'],
    [/counter it unless that player pays (.*?)(?:\.|$)/i, (d) => {
      const c = d.match(/counter it unless that player pays (.*?)(?:\.|$)/i)?.[1] || '';
      return `每当此生物成为由对手所操控之咒语或异能的目标时，除非该牌手支付${c}，否则反击之。`;
    }],
    [/Look at the top (\d+) cards? of your library/i, (d) => {
      const n = d.match(/Look at the top (\d+) cards?/i)?.[1] || '1';
      return `检视你牌库顶的${n}张牌。你可以将其中任意数量的牌置于你的牌库底，其余的则以任意顺序置于你的牌库顶。`;
    }],
    [/cast a noncreature spell, this creature gets \+1\/\+1 until end of turn/i, '每当你施放非生物咒语时，此生物得+1/+1直到回合结束。'],
    [/cast this card face down as a 2\/2 creature for \{3\}/i, '你可以支付{3}，将此牌面朝下当作2/2生物施放。在任意时机支付其变身费用将它翻回正面。'],
    [/cast this card face down for \{3\} as a 2\/2 creature with ward \{2\}/i, '你可以支付{3}，将此牌面朝下当作具守护{2}的2/2生物施放。在任意时机支付其伪装费用将它翻回正面。'],
    [/Discard this card: Draw a card/i, '弃掉此牌：抓一张牌。'],
    [/Your creatures can help cast this spell/i, '你所操控的生物能协助施放此咒语。施放此咒语时你每横置一个生物，就能为此咒语支付{1}或一点该生物颜色的法术力。'],
    [/Each card you exile from your graveyard while casting this spell pays for \{1\}/i, '施放此咒语时，你从坟墓场中放逐的每张牌都能为此咒语支付{1}。'],
    [/cast this card from your graveyard for its flashback cost/i, '你可以从你的坟墓场支付其返照费用来施放此牌，然后将它放逐。'],
    [/Return an unblocked attacker you control to hand/i, '将由你操控且未受阻挡的进攻生物移回其拥有者手上：将此牌从你手上横置放进战场，且正进行攻击。'],
    [/give each another counter of each kind already there/i, '选择任意数量已有指示物的永久物和/或牌手，然后为其各放置一个其上已有之种类的指示物。'],
    [/Put that card into your hand if it's a land/i, '展示你的牌库顶牌。若该牌是地牌，则置入你手上。若不是，则在此生物上放置一个+1/+1指示物，然后你可以将该牌置入你的坟墓场。'],
    [/Draw a card, then discard a card\. If you discarded a nonland card/i, '抓一张牌，然后弃一张牌。若你弃掉非地牌，则在此生物上放置一个+1/+1指示物。'],
    [/Put (\d+) \+1\/\+1 counters? on an Army you control/i, (d) => {
      const n = d.match(/Put (\d+) \+1\/\+1 counters?/i)?.[1] || '1';
      return `在由你操控的军队上放置${n}个+1/+1指示物。若你未操控军队，则先派出一个0/0黑色兽人／军队衍生生物。`;
    }],
    [/sacrifice an artifact, enchantment, or token as you cast this spell/i, '你施放此咒语时，可以牺牲一个神器，结界或衍生代币。'],
    [/exile this card from your hand face down\. Cast it on a later turn for its foretell cost/i, '在你的回合中，你可以支付{2}并将此牌从你手上牌面朝下放逐。在稍后的回合中，你可以支付其预言费用来施放它。'],
    [/cast this spell for its dash cost/i, '你可以支付此咒语的疾冲费用来施放它。若你如此做，它获得敏捷，且在下一个结束步骤开始时从战场移回其拥有者手上。'],
    [/This creature can't block\. When it attacks, sacrifice it at end of combat/i, '此生物不能阻挡。当它攻击时，在战斗结束时将它牺牲。'],
    [/deals combat damage to a player(?:,| also) get(?:s)? (\d+) poison counters?/i, (d) => {
      const n = d.match(/get(?:s)? (\d+) poison counters?/i)?.[1] || '1';
      return `受到此生物战斗伤害的牌手也会得到${n}个中毒指示物。`;
    }],
    [/in the form of -1\/-1 counters and to players in the form of poison counters/i, '此生物以-1/-1指示物的形式对生物造成伤害，且以中毒指示物的形式对牌手造成伤害。'],
    [/defending player sacrifices (\d+) permanents?/i, (d) => {
      const n = d.match(/defending player sacrifices (\d+) permanents?/i)?.[1] || '1';
      return `每当此生物攻击时，防御牌手牺牲${n}个永久物。`;
    }],
    [/blocks or becomes blocked, it gets \+(\d+)\/\+(\d+) until end of turn/i, (d) => {
      const m = d.match(/gets \+(\d+)\/\+(\d+)/i);
      return `每当此生物进行阻挡或被阻挡时，它得+${m[1]}/+${m[2]}直到回合结束。`;
    }],
    [/Tap any number of creatures you control with total power (\d+) or more: This Vehicle becomes an artifact creature until end of turn/i, (d) => {
      const n = d.match(/total power (\d+)/i)?.[1] || '1';
      return `横置任意数量由你操控且力量合计等于或大于${n}的生物：此载具成为神器生物直到回合结束。`;
    }],
    [/Tap any number of other creatures you control with total power (\d+) or more: This Mount becomes saddled until end of turn/i, (d) => {
      const n = d.match(/total power (\d+)/i)?.[1] || '1';
      return `横置任意数量由你操控的其他力量合计等于或大于${n}的生物：此坐骑获得备鞍直到回合结束。只能于法术时机备鞍。`;
    }],
    [/pay an additional (.*?) as you cast this spell\. If you do, when this creature enters, create a 1\/1 token copy of it/i, (d) => {
      const c = d.match(/pay an additional (.*?) as you cast/i)?.[1] || '';
      return `你施放此咒语时可以额外支付${c}。若你如此做，当它进战场时，派出一个它的1/1复制代币。`;
    }],
    [/Exile cards from your graveyard with total mana value (\d+) or more/i, (d) => {
      const n = d.match(/total mana value (\d+)/i)?.[1] || '1';
      return `从你的坟墓场放逐总法术力值等于或大于${n}的牌。`;
    }],
    [/Exile three cards from your graveyard or sacrifice a Food/i, '从你的坟墓场放逐三张牌或牺牲一个食品。'],
    [/Unlock the other door later as a sorcery/i, '施放任意一边。稍后可以于法术时机开启另一扇门。'],
    [/cast this spell with different mana cost, color, and size/i, '你可以使用不同的法术力费用、颜色与攻防来施放此咒语。它保留其异能与类别。'],
    [/put a \+1\/\+1 counter on target creature\. If that's another creature, it gains the following abilities until end of turn/i, '在此生物进战场时，在目标生物上放置一个+1/+1指示物。如果那是另一个生物，则它获得以下异能直到回合结束。'],
    [/Create an Incubator token with (\d+) \+1\/\+1 counters? on it/i, (d) => {
      const n = d.match(/with (\d+) \+1\/\+1 counters?/i)?.[1] || '1';
      return `派出一个上面有${n}个+1/+1指示物且具有「{2}：转化此时器」的玄奥时器代币。它会转化为0/0非瑞人神器生物。`;
    }],
    [/Cast it as a sorcery on a later turn without paying its mana cost/i, '你可以支付其谋划费用并将此牌从你手上放逐。在稍后的回合中，你可以于法术时机且不支付法术力费用来施放它。'],
    [/Exile cards from the top of your library until you exile a nonland card with mana value (\d+) or less/i, (d) => {
      const n = d.match(/mana value (\d+) or less/i)?.[1] || '1';
      return `从你的牌库顶放逐牌，直到放逐一张法术力值等于或小于${n}的非地牌为止。你可以不支付法术力费用施放它，或置入你手上。将其余的牌以随机顺序置于牌库底。`;
    }],
    [/put it onto the battlefield face down as a 2\/2 creature with ward \{2\}/i, '面朝下放进战场当作具守护{2}的2/2生物。若它是生物牌，你可以随时支付其法术力费用将它翻回正面。'],
    [/Choose one or more additional costs/i, '选择一项或多项额外费用。'],
    [/cast this spell for its freerunning cost/i, '若你本回合曾以刺客或指挥官对牌手造成战斗伤害，你可以支付其跑酷费用来施放此咒语。'],
    [/promise an opponent a gift as you cast this spell/i, '你施放此咒语时，可以承诺给一位对手一份赠礼。'],
    [/Whenever this creature becomes the target of a spell or ability you control for the first time each turn/i, '每当此生物在每回合中首次成为由你操控的咒语或异能的目标时触发。'],
    [/Expend (\d+) means: As you spend your (\d+)(?:st|nd|rd|th) total mana/i, (d) => {
      const m = d.match(/Expend (\d+) means: As you spend your (\d+)/i);
      return `耗费${m[1]}意味着：在同一个回合中，当你支付用于施放咒语的第${m[2]}点法术力时触发。`;
    }],
    [/enters with (\d+) time counters and isn't a creature until the last is removed/i, (d) => {
      const n = d.match(/enters with (\d+) time counters/i)?.[1] || '1';
      return `支付其降临费用来施放此咒语。它进战场时上面有${n}个计时指示物，在最后一个指示物移去前它不是生物。`;
    }],
    [/Whenever an enchantment you control enters and whenever you fully unlock a Room/i, '每当一个由你操控的结界进战场，以及每当你完全开启一个房间时触发。'],
    [/second main phase, if this creature is tapped/i, '在你的第二行动阶段开始时，若此生物已横置触发。'],
    [/creature dies, if it had no -1\/-1 counters on it, return it to the battlefield/i, '当此生物死去时，若其上没有-1/-1指示物，则将它在其拥有者的操控下移回战场，且其上有一个-1/-1指示物。'],
    [/creature dies, if it had no \+1\/\+1 counters on it, return it to the battlefield/i, '当此生物死去时，若其上没有+1/+1指示物，则将它在其拥有者的操控下移回战场，且其上有一个+1/+1指示物。'],
    [/dies, you may put its \+1\/\+1 counters on target artifact creature/i, '当此生物死去时，你可以将其上的+1/+1指示物放置在目标神器生物上。'],
    [/opponent was dealt damage this turn, this creature enters the battlefield with/i, '若某对手本回合曾受到伤害，则此生物进战场时上面有额外指示物。'],
    [/Whenever a creature you control attacks alone, that creature gets \+1\/\+1 until end of turn/i, '每当由你操控的生物单独攻击时，该生物得+1/+1直到回合结束。'],
    [/cast this card for its miracle cost when you draw it/i, '当你抓此牌时，如果它是你本回合抓的第一张牌，你可以展示此牌并支付其奇迹费用来施放它。'],
    [/replacing all instances of ['"]target['"] with ['"]each['"]/i, '你可以支付其超载费用来施放它。若你如此做，将此咒语中所有「目标」字样改为「每个」。'],
    [/paired with another unpaired creature when either enters the battlefield/i, '当此生物进战场时，你可以将它与另一个未结对的生物结对。只要你同时操控它们，它们便持续结对。'],
    [/cast a spell, you may pay \{W\/B\}\. If you do, each opponent loses 1 life and you gain that much life/i, '每当你施放咒语时，你可以支付{W/B}。若你如此做，每位对手各失去1点生命，且你获得等量的生命。'],
    [/enter the battlefield with a \+1\/\+1 counter on it\. It can't block as long as it has a \+1\/\+1 counter on it/i, '你可以使此生物进战场时上面有一个+1/+1指示物。只要它上面有+1/+1指示物，它便不能进行阻挡。'],
    [/If you would draw a card, you may mill (\d+) cards instead/i, (d) => {
      const n = d.match(/mill (\d+) cards/i)?.[1] || '1';
      return `如果你将抓一张牌，你可以改为将你牌库顶的${n}张牌置入你的坟墓场。若你如此做，将此牌从你的坟墓场移回你手上。`;
    }],
    [/copy it for each spell cast before it this turn/i, '当你施放此咒语时，本回合在此咒语之前每施放过一个咒语，便将此咒语复制一次。'],
    [/If you discard this card, discard it into exile\. When you do, cast it for its madness cost/i, '如果你弃掉此牌，将其放逐。当你如此做时，你可以支付其疯魔费用来施放它。'],
    [/sacrifice it unless you pay its echo cost/i, '在你的维持开始时，若它是在你上个维持之后才受你操控，则除非你支付其返响费用，否则将它牺牲。']
  ];

  function getMechanicTitle(title) {
    if (!title) return title;
    const t = title.trim();
    const lower = t.toLowerCase();
    let zh = MECHANIC_TITLES[lower];
    if (!zh) {
      for (const [re, rep] of MECHANIC_TITLE_PATTERNS) {
        if (re.test(t)) {
          zh = typeof rep === 'function' ? rep(t) : t.replace(re, rep);
          break;
        }
      }
    }
    if (!zh) zh = t;
    if (Settings.bilingual && zh !== t) {
      return `${zh} (${t})`;
    }
    return zh;
  }

  function getMechanicDescription(desc, title) {
    if (!desc) return desc;
    const d = desc.trim();
    for (const [re, rep] of MECHANIC_DESCRIPTIONS) {
      if (re.test(d)) {
        return typeof rep === 'function' ? rep(d) : rep;
      }
    }
    return d;
  }

  function translateMechanicsPanel() {
    const panels = document.querySelectorAll('aside[aria-label="Card mechanics"], [class*="panel_4adwv"]');
    panels.forEach(panel => {
      const sections = panel.querySelectorAll('section[class*="mechanic_4adwv"], section');
      sections.forEach(sec => {
        const titleEl = sec.querySelector('h2[class*="title_4adwv"] > span:not([class*="icon_4adwv"]):not([class*="cost_4adwv"]), h2 > span:nth-child(2)');
        const descEl = sec.querySelector('p');

        if (titleEl) {
          const origTitle = titleEl.dataset.origText || titleEl.textContent.trim();
          if (!titleEl.dataset.origText) titleEl.dataset.origText = origTitle;
          const zhTitle = getMechanicTitle(origTitle);
          setSafeText(titleEl, zhTitle);
        }

        if (descEl) {
          const origDesc = descEl.dataset.origText || descEl.textContent.trim();
          if (!descEl.dataset.origText) descEl.dataset.origText = origDesc;
          const rawTitle = titleEl ? (titleEl.dataset.origText || titleEl.textContent.trim()) : '';
          const zhDesc = getMechanicDescription(origDesc, rawTitle);
          setSafeText(descEl, zhDesc);
        }
      });
    });
  }

  // ==========================================
  // 6. 页面扫描与防抖观察者
  // ==========================================

  let isTranslating = false;

  function scanAndTranslate() {
    if (isTranslating) return;
    isTranslating = true;

    try {
      const targetState = Settings.enabled ? 'zh' : 'en';

      // 1. 扫描战场地砖、手牌、堆叠等带 data-card 属性的元素
      const cardElements = document.querySelectorAll('[data-card]');
      cardElements.forEach(el => {
        if (el.closest('[aria-hidden="true"]')) return;
        const cardName = el.getAttribute('data-card');
        if (!cardName || cardName === 'Card' || cardName === 'Face-down card') return;

        const cached = memoryCache.get(cardName.toLowerCase());
        if (cached) {
          applyCardTranslation(el, cached);
        } else {
          fetchCardData(cardName).then(data => {
            if (data) {
              isTranslating = true;
              try { applyCardTranslation(el, data); } finally { isTranslating = false; }
            }
          });
        }
      });

      // 2. 扫描独立渲染的大卡牌 (检查抽屉 _card_jzxwn_1)
      const previewCards = document.querySelectorAll('[class*="card_jzxwn"][aria-label]');
      previewCards.forEach(el => {
        if (el.closest('[aria-hidden="true"]')) return;
        const cardName = el.getAttribute('aria-label');
        if (!cardName || cardName === 'Face-down card') return;

        const cached = memoryCache.get(cardName.toLowerCase());
        if (cached) {
          applyCardTranslation(el, cached);
        } else {
          fetchCardData(cardName).then(data => {
            if (data) {
              isTranslating = true;
              try { applyCardTranslation(el, data); } finally { isTranslating = false; }
            }
          });
        }
      });

      // 3. 扫描套牌库与构筑列表卡牌
      const listEntries = document.querySelectorAll(
        '[class*="cardName_t56kq"], [class*="detailName_t56kq"], [class*="entryName_q7pm4"], [class*="cardName_1m4yh"]'
      );
      listEntries.forEach(el => {
        if (el.dataset.forgewebI18n === targetState) return;
        const rawName = el.dataset.origText || el.textContent.trim();
        if (!rawName) return;

        const cached = memoryCache.get(rawName.toLowerCase());
        if (cached) {
          applyListEntryTranslation(el, cached);
        } else {
          fetchCardData(rawName).then(data => {
            if (data) {
              isTranslating = true;
              try { applyListEntryTranslation(el, data); } finally { isTranslating = false; }
            }
          });
        }
      });

      // 4. 扫描并汉化卡牌异能机制说明框 (Card mechanics panel)
      translateMechanicsPanel();
    } finally {
      isTranslating = false;
    }
  }

  function applyTranslationsToPage() {
    scanAndTranslate();
  }

  let observerTimer = null;
  const observer = new MutationObserver(() => {
    if (isTranslating) return;
    if (observerTimer) return;
    observerTimer = setTimeout(() => {
      observerTimer = null;
      scanAndTranslate();
    }, 150);
  });

  function startObserver() {
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-card', 'aria-label', 'class']
      });
      scanAndTranslate();
    } else {
      window.addEventListener('DOMContentLoaded', startObserver);
    }
  }

  // ==========================================
  // 7. 交互功能：Alt+点击卡查直达
  // ==========================================

  function setupInteractions() {
    document.addEventListener('click', (e) => {
      if (e.altKey) {
        const cardTarget = e.target.closest('[data-card], [class*="card_jzxwn"], [class*="tile_y09se"]');
        if (cardTarget) {
          e.preventDefault();
          e.stopPropagation();
          const cardName = cardTarget.getAttribute('data-card') || cardTarget.getAttribute('aria-label');
          if (cardName) {
            const cached = memoryCache.get(cardName.toLowerCase());
            let openUrl = `https://mtgch.com/search?q=${encodeURIComponent(`!"${cardName}"`)}`;
            if (cached && cached.setCode && cached.collectorNumber) {
              openUrl = `https://mtgch.com/card/${cached.setCode.toUpperCase()}/${cached.collectorNumber}`;
            }
            if (typeof GM_openInTab !== 'undefined') {
              try {
                GM_openInTab(openUrl, false);
                return;
              } catch (err) {}
            }
            window.open(openUrl, '_blank');
          }
        }
      }
    }, true);
  }

  // ==========================================
  // 8. 悬浮状态栏控制面板 (UI Control Widget)
  // ==========================================

  function injectControlWidget() {
    if (document.getElementById('forgeweb-i18n-widget')) return;
    if (!document.body) return;

    const widget = document.createElement('div');
    widget.id = 'forgeweb-i18n-widget';
    widget.className = 'forgeweb-i18n-root';
    widget.innerHTML = `
      <div class="forgeweb-i18n-badge" id="forgeweb-i18n-toggle" title="点击展开汉化设置 / Alt+点击任意卡牌在大学院废墟查牌">
        <span class="forgeweb-i18n-icon">文</span>
        <span class="forgeweb-i18n-status ${Settings.enabled ? 'active' : ''}">${Settings.enabled ? '中' : 'EN'}</span>
      </div>
      <div class="forgeweb-i18n-panel" id="forgeweb-i18n-panel">
        <div class="forgeweb-i18n-header">
          <strong>${SCRIPT_NAME}</strong>
          <span class="forgeweb-i18n-ver">v${SCRIPT_VERSION}</span>
        </div>
        <div class="forgeweb-i18n-row">
          <span>卡牌汉化</span>
          <button id="forgeweb-btn-toggle" class="forgeweb-i18n-btn ${Settings.enabled ? 'primary' : ''}">
            ${Settings.enabled ? '已开启' : '已暂停'}
          </button>
        </div>
        <div class="forgeweb-i18n-row">
          <span>双语牌名对照</span>
          <input type="checkbox" id="forgeweb-chk-bilingual" ${Settings.bilingual ? 'checked' : ''} />
        </div>
        <div class="forgeweb-i18n-info">
          <div>本地缓存卡牌: <span id="forgeweb-cache-count">${memoryCache.size}</span> 张</div>
          <div class="forgeweb-i18n-tip">💡 快捷操作：按住 <kbd>Alt</kbd> 点击任意卡牌，可直接在大学院废墟查阅官方裁定与原画。</div>
        </div>
        <div class="forgeweb-i18n-actions">
          <button id="forgeweb-btn-refresh" class="forgeweb-i18n-btn-sm" title="强制重新扫描当前战场卡牌">重新翻译</button>
          <button id="forgeweb-btn-clear" class="forgeweb-i18n-btn-sm" title="清除本地卡牌翻译缓存">清空缓存</button>
        </div>
      </div>
    `;

    document.body.appendChild(widget);

    const badge = document.getElementById('forgeweb-i18n-toggle');
    const panel = document.getElementById('forgeweb-i18n-panel');
    const toggleBtn = document.getElementById('forgeweb-btn-toggle');
    const bilingualChk = document.getElementById('forgeweb-chk-bilingual');
    const refreshBtn = document.getElementById('forgeweb-btn-refresh');
    const clearBtn = document.getElementById('forgeweb-btn-clear');
    const statusSpan = widget.querySelector('.forgeweb-i18n-status');
    const cacheCountSpan = document.getElementById('forgeweb-cache-count');

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!widget.contains(e.target)) {
        panel.classList.remove('show');
      }
    });

    toggleBtn.addEventListener('click', () => {
      Settings.enabled = !Settings.enabled;
      Storage.set('enabled', Settings.enabled);

      toggleBtn.className = `forgeweb-i18n-btn ${Settings.enabled ? 'primary' : ''}`;
      toggleBtn.textContent = Settings.enabled ? '已开启' : '已暂停';
      statusSpan.className = `forgeweb-i18n-status ${Settings.enabled ? 'active' : ''}`;
      statusSpan.textContent = Settings.enabled ? '中' : 'EN';

      document.querySelectorAll('[data-forgeweb-i18n]').forEach(el => delete el.dataset.forgewebI18n);
      scanAndTranslate();
    });

    bilingualChk.addEventListener('change', () => {
      Settings.bilingual = bilingualChk.checked;
      Storage.set('bilingual', Settings.bilingual);
      document.querySelectorAll('[data-forgeweb-i18n]').forEach(el => delete el.dataset.forgewebI18n);
      scanAndTranslate();
    });

    refreshBtn.addEventListener('click', () => {
      document.querySelectorAll('[data-forgeweb-i18n]').forEach(el => delete el.dataset.forgewebI18n);
      scanAndTranslate();
      cacheCountSpan.textContent = memoryCache.size;
    });

    clearBtn.addEventListener('click', () => {
      memoryCache.clear();
      for (const [k, v] of Object.entries(BUILTIN_CARDS)) {
        memoryCache.set(k.toLowerCase(), v);
      }
      Storage.set('card_cache_v3', {});
      cacheCountSpan.textContent = memoryCache.size;
      document.querySelectorAll('[data-forgeweb-i18n]').forEach(el => delete el.dataset.forgewebI18n);
      scanAndTranslate();
    });
  }

  // ==========================================
  // 9. 样式注入
  // ==========================================

  const STYLES = `
    .forgeweb-i18n-root {
      position: fixed;
      bottom: 18px;
      right: 18px;
      z-index: 99999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      user-select: none;
    }
    .forgeweb-i18n-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(22, 27, 34, 0.92);
      color: #e6edf3;
      padding: 6px 10px;
      border-radius: 20px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(8px);
      transition: all 0.2s ease;
    }
    .forgeweb-i18n-badge:hover {
      background: rgba(30, 36, 46, 0.98);
      border-color: #3b82f6;
      transform: translateY(-1px);
    }
    .forgeweb-i18n-icon {
      font-weight: 700;
      font-size: 13px;
      color: #60a5fa;
    }
    .forgeweb-i18n-status {
      font-size: 11px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 10px;
      background: #374151;
      color: #9ca3af;
    }
    .forgeweb-i18n-status.active {
      background: #2563eb;
      color: #ffffff;
    }
    .forgeweb-i18n-panel {
      position: absolute;
      bottom: 42px;
      right: 0;
      width: 280px;
      background: rgba(17, 24, 39, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(12px);
      color: #e5e7eb;
      display: none;
      flex-direction: column;
      gap: 10px;
    }
    .forgeweb-i18n-panel.show {
      display: flex;
    }
    .forgeweb-i18n-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 8px;
    }
    .forgeweb-i18n-ver {
      font-size: 11px;
      color: #9ca3af;
    }
    .forgeweb-i18n-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
    }
    .forgeweb-i18n-row input[type="checkbox"] {
      cursor: pointer;
      width: 16px;
      height: 16px;
      accent-color: #2563eb;
    }
    .forgeweb-i18n-btn {
      padding: 4px 12px;
      border-radius: 6px;
      border: 1px solid #4b5563;
      background: #1f2937;
      color: #d1d5db;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .forgeweb-i18n-btn.primary {
      background: #2563eb;
      border-color: #3b82f6;
      color: #ffffff;
    }
    .forgeweb-i18n-info {
      font-size: 11px;
      color: #9ca3af;
      line-height: 1.4;
    }
    .forgeweb-i18n-tip {
      margin-top: 6px;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      color: #cbd5e1;
    }
    .forgeweb-i18n-tip kbd {
      background: #334155;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 10px;
    }
    .forgeweb-i18n-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    .forgeweb-i18n-btn-sm {
      flex: 1;
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid #374151;
      background: #1f2937;
      color: #9ca3af;
      font-size: 11px;
      cursor: pointer;
    }
    .forgeweb-i18n-btn-sm:hover {
      background: #374151;
      color: #ffffff;
    }

    /* 安全覆层规则文本样式 */
    .forgeweb-zh-rules {
      font-size: inherit;
      line-height: 1.35;
      word-break: break-word;
      user-select: text;
    }
    .forgeweb-zh-rules p {
      margin: 0 0 0.25em 0;
    }
    .forgeweb-zh-rules p:last-child {
      margin-bottom: 0;
    }
    [class*="cardName_jzxwn"], [class*="tileName_y09se"] {
      letter-spacing: 0.02em;
    }
  `;

  function injectStyles() {
    if (typeof GM_addStyle !== 'undefined') {
      try {
        GM_addStyle(STYLES);
        return;
      } catch (e) {}
    }
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES;
    const target = document.head || document.documentElement || document.body;
    if (target) {
      target.appendChild(styleEl);
    } else {
      window.addEventListener('DOMContentLoaded', () => {
        (document.head || document.documentElement || document.body).appendChild(styleEl);
      });
    }
  }

  // ==========================================
  // 10. 油猴菜单注册与初始化启动
  // ==========================================

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'undefined') {
      try {
        GM_registerMenuCommand(`切换卡牌汉化 (${Settings.enabled ? '已开启' : '已暂停'})`, () => {
          Settings.enabled = !Settings.enabled;
          Storage.set('enabled', Settings.enabled);
          document.querySelectorAll('[data-forgeweb-i18n]').forEach(el => delete el.dataset.forgewebI18n);
          scanAndTranslate();
        });
        GM_registerMenuCommand('访问大学院废墟 (mtgch.com)', () => {
          if (typeof GM_openInTab !== 'undefined') {
            try {
              GM_openInTab('https://mtgch.com', false);
              return;
            } catch (e) {}
          }
          window.open('https://mtgch.com', '_blank');
        });
      } catch (e) {}
    }
  }

  function init() {
    injectStyles();
    registerMenuCommands();
    startObserver();
    setupInteractions();

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', injectControlWidget);
    } else {
      injectControlWidget();
    }
  }

  init();

})();
