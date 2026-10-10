/**
 * Local command interpreter.
 *
 * A deliberately bounded, pattern-based natural-language router. It is NOT an
 * AI agent — when it cannot interpret a command it says so honestly instead of
 * guessing.
 *
 * This module is the replaceable integration point for the future runtime AI
 * agent: implement the same `interpret(command, context)` contract (or drive
 * the browser API directly and stream the same typed events) and nothing else
 * in the stack has to change.
 */

/**
 * @typedef {{op:string, [k:string]:any, label:string}} Step
 * @typedef {{ok:true, steps:Step[]} | {ok:false, reason:string, hint?:string}} Plan
 */

const vid = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

/** Site registry: home URL, real search-field selectors, direct search URL, result selectors. */
export const SITES = {
  youtube: {
    label: 'YouTube',
    url: 'https://www.youtube.com/',
    searchUrl: vid,
    searchSelectors: ['input#search', 'input[name="search_query"]', 'input[role="combobox"]'],
    resultSelectors: ['ytd-video-renderer a#video-title', 'a#video-title'],
    videoResults: true,
    aliases: ['youtube', 'yt'],
  },
  google: {
    label: 'Google',
    url: 'https://www.google.com/',
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    searchSelectors: ['textarea[name="q"]', 'input[name="q"]', 'input[role="combobox"]'],
    resultSelectors: ['#search a h3', 'div#search a'],
    aliases: ['google'],
  },
  bing: {
    label: 'Bing',
    url: 'https://www.bing.com/',
    searchUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    searchSelectors: ['input[name="q"]', '#sb_form_q'],
    resultSelectors: ['#b_results h2 a'],
    aliases: ['bing'],
  },
  duckduckgo: {
    label: 'DuckDuckGo',
    url: 'https://duckduckgo.com/',
    searchUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    searchSelectors: ['input[name="q"]', 'input[type="search"]'],
    resultSelectors: ['a[data-testid="result-title-a"]', 'h2 a'],
    aliases: ['duckduckgo', 'ddg'],
  },
  github: {
    label: 'GitHub',
    url: 'https://github.com/',
    searchUrl: (q) => `https://github.com/search?q=${encodeURIComponent(q)}&type=repositories`,
    searchSelectors: ['input[name="q"]', '#search-input input'],
    resultSelectors: ['a[data-testid="results-list"] a', '#results-list a'],
    aliases: ['github'],
  },
  reddit: {
    label: 'Reddit',
    url: 'https://www.reddit.com/',
    searchUrl: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`,
    searchSelectors: ['input[type="search"]', 'input[name="q"]'],
    resultSelectors: ['a[data-testid="post-title"]', 'a[href*="/comments/"] h3'],
    aliases: ['reddit'],
  },
  wikipedia: {
    label: 'Wikipedia',
    url: 'https://www.wikipedia.org/',
    searchUrl: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
    searchSelectors: ['#searchInput', 'input[name="search"]'],
    resultSelectors: ['.mw-search-result-heading a', '.searchresult a'],
    aliases: ['wikipedia', 'wiki'],
  },
  stackoverflow: {
    label: 'Stack Overflow',
    url: 'https://stackoverflow.com/',
    searchUrl: (q) => `https://stackoverflow.com/search?q=${encodeURIComponent(q)}`,
    searchSelectors: ['#search-input input', 'input[name="q"]'],
    resultSelectors: ['.s-post-summary--content-title a'],
    aliases: ['stackoverflow', 'so'],
  },
  x: {
    label: 'X',
    url: 'https://x.com/',
    searchUrl: (q) => `https://x.com/search?q=${encodeURIComponent(q)}&f=live`,
    searchSelectors: ['input[data-testid="SearchBox_Search_Input"]', 'input[type="text"]'],
    resultSelectors: ['article a[href*="/status/"]'],
    aliases: ['x', 'twitter'],
  },
  amazon: {
    label: 'Amazon',
    url: 'https://www.amazon.com/',
    searchUrl: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
    searchSelectors: ['#twotabsearchtextbox', 'input[name="field-keywords"]'],
    resultSelectors: ['a.a-link-normal.s-line-clamp-2 h2 span', 'div[data-component-type="s-search-result"] h2 a'],
    aliases: ['amazon'],
  },
  chatgpt: {
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    aliases: ['chatgpt', 'openai'],
  },
  claude: {
    label: 'Claude',
    url: 'https://claude.ai/',
    aliases: ['claude', 'anthropic'],
  },
  gmail: { label: 'Gmail', url: 'https://mail.google.com/', aliases: ['gmail', 'mail'] },
  maps: { label: 'Google Maps', url: 'https://maps.google.com/', aliases: ['maps', 'google maps'] },
  drive: { label: 'Google Drive', url: 'https://drive.google.com/', aliases: ['drive'] },
  netflix: { label: 'Netflix', url: 'https://www.netflix.com/', aliases: ['netflix'] },
  linkedin: { label: 'LinkedIn', url: 'https://www.linkedin.com/', aliases: ['linkedin'] },
  facebook: { label: 'Facebook', url: 'https://www.facebook.com/', aliases: ['facebook'] },
  instagram: { label: 'Instagram', url: 'https://www.instagram.com/', aliases: ['instagram'] },
  twitch: { label: 'Twitch', url: 'https://www.twitch.tv/', aliases: ['twitch'] },
  medium: { label: 'Medium', url: 'https://medium.com/', aliases: ['medium'] },
};

/** Resolve a bare token ("youtube", "wiki") to its site entry. */
export function siteForToken(token) {
  const t = String(token ?? '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[.\s]+$/g, '');
  if (!t) return null;
  for (const entry of Object.values(SITES)) {
    if (entry.aliases.some((a) => a === t)) return entry;
  }
  return null;
}

/** Resolve a clause target: site alias, bare domain, or full URL. */
export function resolveTarget(raw) {
  const text = String(raw ?? '').trim().replace(/[!?]+$/, '').trim();
  const site = siteForToken(text);
  if (site) return { kind: 'site', site, text };
  if (/^https?:\/\//i.test(text)) return { kind: 'url', url: text, text };
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(text)) return { kind: 'url', url: text, text };
  return { kind: 'unknown', text };
}

/** host → site entry, so "search for X" can inherit the current site. */
export function siteForHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/^www\./, '');
  if (!h) return null;
  for (const entry of Object.values(SITES)) {
    try {
      const hostOf = new URL(entry.url).hostname.replace(/^www\./, '');
      if (h === hostOf || h.endsWith(`.${hostOf}`)) return entry;
    } catch {
      /* ignore malformed registry entries */
    }
  }
  return null;
}

const stripEnd = (s) =>
  s
    .trim()
    // Trailing sentence punctuation is safe to drop: a valid domain never ends
    // in "." and resolveTarget re-adds "https://" itself.
    .replace(/[.!?,]+$/, '')
    .trim();

/** Split a command into ordered clauses and merge pronoun continuations ("…, and open it"). */
export function splitClauses(command) {
  const parts = String(command)
    .split(/\s*,\s*(?:and\s+)?|\s+then\s+|\s+and\s+(?=[a-z])/i)
    .map(stripEnd)
    .filter(Boolean);
  const merged = [];
  for (const part of parts) {
    const pronoun = /^(?:open|click|select|play|use|do)\s+(?:it|that|this|them|the\s+(?:video|result|link|first\s+one))$/i;
    if (merged.length && pronoun.test(part)) merged[merged.length - 1] += ` and ${part}`;
    else merged.push(part);
  }
  return merged;
}

const PRONOUN_ONLY = /^(?:open|click|select|play)\s+(?:it|that|this|them|the\s+(?:video|result|link|first\s+one))$/i;

/**
 * Parse a single clause into a step.
 * @returns {Step|null} null when the clause is not understood
 */
export function parseClause(clause, ctx = {}) {
  const c = stripEnd(clause);
  const l = c.toLowerCase();
  const currentSite = ctx.currentUrl ? siteForHost(safeHost(ctx.currentUrl)) : null;
  const fallbackSite = ctx.lastSite ?? currentSite;

  // --- tabs ------------------------------------------------------------------
  if (/^(?:open\s+)?a?\s*(?:new|another)\s+tab$/.test(l)) {
    return { op: 'newTab', label: 'Open a new tab' };
  }
  if (/^(?:close|kill)\s+(?:this|the current)?\s*tab$/.test(l)) {
    return { op: 'closeTab', label: 'Close tab' };
  }
  let m = c.match(/^(?:switch|go|jump|change)\s+to\s+tab\s+(.+)$/i);
  if (m) return parseTabRef(m[1]);
  m = c.match(/^tab\s+(\d+|next|last|first)$/i);
  if (m) return parseTabRef(m[1]);

  // --- history ---------------------------------------------------------------
  if (/^(?:go\s+)?back(?:\s+to\s+the\s+previous\s+page)?$/.test(l)) return { op: 'back', label: 'Go back' };
  if (/^(?:go\s+)?forward$/.test(l)) return { op: 'forward', label: 'Go forward' };

  // --- scrolling -------------------------------------------------------------
  m = c.match(/^scroll\s+(down|up|to\s+top|to\s+bottom)(?:\s+(\d+)\s*(?:px|pixels?)?)?$/i);
  if (m) {
    const dir = /^to\s+/i.test(m[1]) ? m[1].replace(/^to\s+/i, '') : m[1];
    return { op: 'scroll', dir, amount: m[2] ? Number(m[2]) : undefined, label: `Scroll ${dir}` };
  }

  // --- read-only inspection --------------------------------------------------
  if (/^(?:what(?:'s|\s+is)\s+the\s+)?(?:page\s+)?title(?:\s+of\s+this\s+page)?$/.test(l) || l === 'read the title') {
    return { op: 'readTitle', label: 'Read the page title' };
  }
  if (/^what(?:'s|\s+is)\s+the\s+(?:current\s+|page\s+)?(?:url|address|link)$/.test(l) || l === 'read the url') {
    return { op: 'readUrl', label: 'Read the current URL' };
  }

  // --- searching -------------------------------------------------------------
  m = c.match(/^search\s+(.+?)\s+for\s+(.+)$/i);
  if (m) {
    const target = resolveTarget(m[1]);
    if (target.kind === 'unknown') return null; // fall through to generic patterns
    const site = target.kind === 'site' ? target.site : siteForHost(safeHost(target.url)) ?? null;
    if (!site) return { op: 'unsupported', label: `Search on ${target.text}`, reason: `Search is not supported for "${target.text}" by the local executor.` };
    return { op: 'search', site, query: m[2].trim(), label: `Search ${site.label} for “${m[2].trim()}”` };
  }
  m = c.match(/^(?:search|look\s+up|google|find)\s+for\s+(.+)$/i) || c.match(/^(?:search|look\s+up|google)\s+(.+)$/i);
  if (m && !/^(?:search|find)\b.*\b(?:video|result)\b.*\b(?:open|play)\b/i.test(l)) {
    const query = m[1].trim();
    const site = fallbackSite;
    if (site?.searchUrl) return { op: 'search', site, query, label: `Search ${site.label} for “${query}”` };
    // No site established yet — resolved to Google at run time, but labelled
    // honestly because the choice is not known when the plan is previewed.
    return {
      op: 'search',
      site: SITES.google,
      query,
      label: `Search for “${query}” (on the current site, else Google)`,
    };
  }

  // --- open / play a result or video ----------------------------------------
  if (/^(?:open|play|find|watch)\b/.test(l) && /\b(video|result|link)\b/.test(l)) {
    const strategy = /\b(latest|newest|recent)\b/.test(l) ? 'latest' : PRONOUN_ONLY.test(c) ? 'context' : 'first';
    const textMatch = c.match(/(?:video|result|link)\s+(?:called|named|titled|with)\s+(.+)$/i);
    return {
      op: 'openResult',
      strategy,
      match: textMatch?.[1]?.trim() ?? null,
      label: strategy === 'latest' ? 'Open the latest video' : textMatch ? `Open the result “${textMatch[1].trim()}”` : 'Open the first result',
    };
  }
  if (PRONOUN_ONLY.test(c)) {
    return { op: 'openResult', strategy: 'context', label: 'Open the last result' };
  }

  // --- typing into a field ---------------------------------------------------
  m = c.match(/^(?:type|enter|fill|put)\s+(.+?)\s+into\s+(?:the\s+)?(.+)$/i);
  if (m) {
    return { op: 'fill', text: m[1].trim(), field: m[2].trim(), label: `Type “${m[1].trim()}” into ${m[2].trim()}` };
  }

  // --- clicking --------------------------------------------------------------
  m = c.match(/^(?:click|press|select|tap)\s+(?:on\s+)?(?:the\s+)?(.+)$/i);
  if (m) return { op: 'click', text: m[1].trim(), label: `Click “${m[1].trim()}”` };

  // --- navigation ------------------------------------------------------------
  m = c.match(/^(?:open|go\s+to|visit|navigate\s+to|load|browse)\s+(.+)$/i);
  if (m) {
    const target = resolveTarget(m[1]);
    if (target.kind === 'site') {
      return { op: 'navigate', url: target.site.url, label: target.site.label, site: target.site };
    }
    if (target.kind === 'url') {
      return { op: 'navigate', url: target.url, label: target.text };
    }
    // Surface a specific, honest reason for unsafe or malformed targets
    // instead of a generic "not understood".
    const scheme = m[1].match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    if (scheme && ['javascript', 'data', 'file', 'blob', 'about', 'chrome', 'devtools'].includes(scheme)) {
      return {
        op: 'unsupported',
        label: `Blocked ${scheme}: URL`,
        reason: `Blocked unsafe URL scheme "${scheme}:" — NOVA only navigates to http(s) addresses.`,
      };
    }
    if (/\s/.test(m[1]) || !/[\w.-]/.test(m[1])) {
      return {
        op: 'unsupported',
        label: `Navigate to ${m[1].slice(0, 30)}`,
        reason: `"${m[1]}" is not a recognised site or a valid URL.`,
      };
    }
    return null;
  }

  return null;
}

function parseTabRef(ref) {
  const r = String(ref).trim().toLowerCase();
  if (r === 'next') return { op: 'switchTab', delta: 1, label: 'Switch to the next tab' };
  if (r === 'last') return { op: 'switchTab', delta: -1, label: 'Switch to the last tab' };
  if (r === 'first') return { op: 'switchTab', index: 0, label: 'Switch to the first tab' };
  const n = Number(r);
  if (Number.isInteger(n) && n >= 1) return { op: 'switchTab', index: n - 1, label: `Switch to tab ${n}` };
  return { op: 'unsupported', label: `Switch to tab ${ref}`, reason: `Could not resolve tab reference "${ref}".` };
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Interpret a whole command into an ordered plan.
 * @returns {Plan}
 */
export function interpret(command, ctx = {}) {
  const clauses = splitClauses(command);
  if (!clauses.length) {
    return { ok: false, reason: 'The command is empty.', hint: 'Type a request such as "Open YouTube".' };
  }
  const steps = [];
  for (const clause of clauses) {
    const step = parseClause(clause, ctx);
    if (!step) {
      return {
        ok: false,
        reason: `The local executor does not understand "${clause}".`,
        hint: 'Supported: open a site, go to a URL, search a site for text, open the latest/first result, click a link by text, type into a field, scroll, go back/forward, open/switch/close tabs, read the title or URL.',
      };
    }
    steps.push(step);
  }
  return { ok: true, steps };
}

export const SUPPORTED_PATTERNS = [
  'Open <site> — e.g. "Open YouTube"',
  'Go to <url> — e.g. "Go to github.com"',
  'Search <site> for <text> — e.g. "Search YouTube for Technical Guruji"',
  'Search <text> — uses the current site (or Google)',
  'Find/open the latest video and open it — YouTube results with an explicit selection strategy',
  'Click <link text>',
  'Type <text> into <field>',
  'Scroll down / Scroll up',
  'Go back / Go forward',
  'Open a new tab / Switch to tab 2 / Close tab',
  "Read the title / What's the url",
];
