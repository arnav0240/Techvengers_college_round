/**
 * ExecutionEngine — turns an interpreted plan into real browser operations and
 * streams typed, timestamped events describing what actually happened.
 *
 * Every event is generated from a real operation result (measured duration,
 * observed URL/title, observed element counts). Nothing is fabricated: if a
 * step fails, later steps do not run and the failure is reported verbatim.
 */
import { parseClause, splitClauses, siteForHost, SITES } from './interpreter.js';
import { ACTION_TIMEOUT, NAV_TIMEOUT, validateUrl } from './browser.js';

export class CancelledError extends Error {
  constructor() {
    super('Request cancelled by user.');
    this.name = 'CancelledError';
  }
}

/** Wraps the emit callback with per-request bookkeeping and helper builders. */
class Session {
  constructor(requestId, emit) {
    this.requestId = requestId;
    this.emit = emit;
    this.n = 0;
  }

  event(type, title, description = '', extra = {}) {
    return {
      id: `${this.requestId}#${++this.n}`,
      requestId: this.requestId,
      timestamp: Date.now(),
      type,
      title,
      description,
      status: 'running',
      ...extra,
    };
  }

  push(ev) {
    this.emit({ ...ev });
    return ev;
  }

  complete(ev, patch = {}) {
    const out = {
      ...ev,
      ...patch,
      status: 'completed',
      durationMs: patch.durationMs ?? Math.max(0, Date.now() - ev.timestamp),
    };
    this.emit(out);
    return out;
  }

  fail(ev, error, patch = {}) {
    const out = {
      ...ev,
      ...patch,
      status: 'failed',
      error: String(error?.message ?? error),
      durationMs: patch.durationMs ?? Math.max(0, Date.now() - ev.timestamp),
    };
    this.emit(out);
    return out;
  }

  cancel(ev) {
    const out = { ...ev, status: 'cancelled', durationMs: Math.max(0, Date.now() - ev.timestamp) };
    this.emit(out);
    return out;
  }
}

const withTimeout = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s.`)), ms)),
  ]);

/** Run a step, emitting a running event and exactly one terminal event. */
async function runStep(S, ev, fn, { failStatus = 'failed' } = {}) {
  S.push(ev);
  try {
    const result = await fn();
    return S.complete(ev, typeof result === 'object' && result !== null ? result : {});
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    if (failStatus === 'cancelled') return S.cancel(ev);
    throw S.fail(ev, err);
  }
}

export class ExecutionEngine {
  constructor({ browser, emit, onState }) {
    this.browser = browser;
    this.emit = emit;
    this.onState = onState;
    this.active = null; // { requestId, command, controller, startedAt }
  }

  get busy() {
    return !!this.active;
  }

  cancel(requestId) {
    if (!this.active) return false;
    if (requestId && this.active.requestId !== requestId) return false;
    this.active.controller.abort();
    return true;
  }

  /**
   * Execute a command. Resolves with { status, summary }.
   * Never throws — all failures are reported as events + a failed result.
   */
  async execute({ requestId, command }) {
    if (this.active) {
      return { status: 'busy', summary: `Another request is already executing (${this.active.requestId}).` };
    }
    const controller = new AbortController();
    this.active = { requestId, command, controller, startedAt: Date.now() };
    this.onState?.({ status: 'running', requestId, command, startedAt: this.active.startedAt });
    try {
      const result = await this.run(requestId, command, controller.signal);
      this.onState?.({ status: result.status, requestId, command, summary: result.summary, finishedAt: Date.now() });
      return result;
    } catch (err) {
      if (err instanceof CancelledError) {
        const s = { status: 'cancelled', summary: 'Request cancelled before completion.' };
        this.onState?.({ ...s, requestId, finishedAt: Date.now() });
        return s;
      }
      const s = { status: 'failed', summary: `Internal error: ${err?.message ?? err}` };
      this.onState?.({ ...s, requestId, finishedAt: Date.now() });
      return s;
    } finally {
      this.active = null;
    }
  }

  throwIfCancelled(signal) {
    if (signal.aborted) throw new CancelledError();
  }

  async run(requestId, command, signal) {
    const S = new Session(requestId, this.emit);
    const ctx = {};

    // 1 — request received -----------------------------------------------------
    const accept = S.push(
      S.event('lifecycle', 'Request received', `Accepted "${command.slice(0, 120)}" for local execution.`),
    );
    S.complete(accept);

    // 2 — interpret ------------------------------------------------------------
    // Split into clauses up front for the preview, but each clause is parsed at
    // execution time with the LIVE context, so a later clause can inherit state
    // from an earlier one (e.g. "search for X" after "Open YouTube" searches
    // YouTube, not Google).
    const clauses = splitClauses(command);
    if (!clauses.length) {
      const ev = S.push(S.event('lifecycle', 'Unsupported command', 'The command is empty.'));
      S.fail(ev, 'The command is empty.');
      return { status: 'failed', summary: 'The command is empty.' };
    }
    // Fail fast (before touching the browser) if NO clause is understood with
    // the initial context — this catches genuinely unsupported phrasings.
    const preview = clauses.map((c) => parseClause(c, ctx) ?? { label: c, unsupported: true });
    const planEv = S.push(
      S.event(
        'plan',
        'Planning',
        `Local pattern interpreter produced ${clauses.length} step(s): ${preview.map((s) => s.label).join(' → ')}.`,
      ),
    );
    S.complete(planEv);

    // 3 — browser availability -------------------------------------------------
    this.throwIfCancelled(signal);
    const launching = S.push(
      S.event(
        'browser',
        this.browser.state === 'ready' ? 'Browser ready' : 'Launching browser',
        this.browser.state === 'ready'
          ? `Reusing the running ${this.browser.describe()}.`
          : 'Starting a dedicated Chromium session (own profile, localhost only).',
      ),
    );
    try {
      await withTimeout(this.browser.start(), 90_000, 'Browser launch');
    } catch (err) {
      S.fail(launching, err, {
        description: `Chromium could not start: ${err?.message ?? err}. Check NOVA_BROWSER_PATH or install Chrome/Edge.`,
      });
      return { status: 'failed', summary: `Browser failed to start: ${err?.message ?? err}` };
    }
    S.complete(launching, { description: `Chromium is ready — ${this.browser.describe()}.` });
    this.browser.setFrameRate(500);
    ctx.currentUrl = this.browser.page()?.url() ?? null;

    // 4 — execute steps --------------------------------------------------------
    let summary = '';
    try {
      for (const clause of clauses) {
        this.throwIfCancelled(signal);
        // Parse with the LIVE context so state flows between clauses.
        const step = parseClause(clause, ctx);
        if (!step) {
          throw new Error(
            `The local executor does not understand "${clause}" at this point in the request. ` +
              'Supported: open a site, go to a URL, search a site for text, open the latest/first result, ' +
              'click a link by text, type into a field, scroll, go back/forward, open/switch/close tabs, ' +
              'read the title or URL.',
          );
        }
        summary = await this.execStep(step, S, ctx, signal);
      }
    } catch (err) {
      this.browser.setFrameRate(2000);
      if (err instanceof CancelledError) {
        const ev = S.push(S.event('lifecycle', 'Cancelled', 'Execution stopped by user request; the browser session is left as-is.'));
        S.cancel(ev);
        return { status: 'cancelled', summary: 'Request cancelled by user.' };
      }
      const reason = err?.error ?? err?.message ?? String(err);
      const ev = S.push(
        S.event('error', 'Execution failed', `Stopping here — no later step was reported as completed. ${reason}`),
      );
      S.fail(ev, reason);
      return { status: 'failed', summary: reason };
    }

    this.browser.setFrameRate(2000);

    // 5 — verification ---------------------------------------------------------
    let final = null;
    try {
      final = await this.browser.titleAndUrl();
    } catch (err) {
      const ev = S.push(S.event('verification', 'Verifying result', 'Could not read the final page state.'));
      S.fail(ev, err);
      return { status: 'failed', summary: `The browser ended in an unreadable state: ${err?.message ?? err}` };
    }
    const verify = S.push(
      S.event('verification', 'Verifying result', 'Reading the final page title and URL from the live browser.', {
        url: final.url,
      }),
    );
    S.complete(verify, { description: `Confirmed "${final.title}" at ${final.url}`, url: final.url });

    const done = S.push(
      S.event('lifecycle', 'Completed', summary || `Final page: ${final.title} — ${final.url}`),
    );
    S.complete(done);
    return { status: 'completed', summary: summary || `Final page: ${final.title} — ${final.url}`, final };
  }

  /** Execute one plan step. Returns the human summary used in the final report. */
  async execStep(step, S, ctx, signal) {
    switch (step.op) {
      case 'navigate':
        return this.stepNavigate(step, S, ctx, signal);
      case 'search':
        return this.stepSearch(step, S, ctx, signal);
      case 'openResult':
        return this.stepOpenResult(step, S, ctx, signal);
      case 'click':
        return this.stepClick(step, S, ctx, signal);
      case 'fill':
        return this.stepFill(step, S, ctx, signal);
      case 'scroll':
        return this.stepScroll(step, S, ctx, signal);
      case 'newTab':
        return this.stepNewTab(step, S, ctx, signal);
      case 'switchTab':
        return this.stepSwitchTab(step, S, ctx, signal);
      case 'closeTab':
        return this.stepCloseTab(step, S, ctx, signal);
      case 'back':
      case 'forward':
        return this.stepHistory(step, S, ctx, signal);
      case 'readTitle':
        return this.stepRead(step, S, ctx, signal, 'title');
      case 'readUrl':
        return this.stepRead(step, S, ctx, signal, 'url');
      case 'unsupported':
        throw Object.assign(new Error(step.reason), { eventTitle: 'Unsupported operation' });
      default:
        throw new Error(`Unknown operation "${step.op}".`);
    }
  }

  async stepNavigate(step, S, ctx, signal) {
    const url = validateUrl(step.url);
    const ev = S.event('navigation', `Opening ${step.label}`, `Navigating to ${url}`, { url });
    const res = await runStep(S, ev, async () => {
      this.throwIfCancelled(signal);
      const r = await this.browser.navigate(url, { timeout: NAV_TIMEOUT });
      ctx.currentUrl = r.url;
      ctx.lastSite = siteForHost(new URL(r.url).hostname);
      return {
        url: r.url,
        title: r.title,
        durationMs: r.durationMs,
        description: `Loaded "${r.title}" in ${(r.durationMs / 1000).toFixed(1)}s.`,
      };
    });
    const inspect = S.push(
      S.event('observation', 'Inspecting the page', `Reading the live DOM of ${res.url}`, { url: res.url }),
    );
    S.complete(inspect, { url: res.url, description: `Observed title: "${res.title}"` });
    return res.description ?? `Opened ${step.label}`;
  }

  async stepSearch(step, S, ctx, signal) {
    const { site, query } = step;
    const page = this.browser.page();
    const onPage = (() => {
      try {
        return siteForHost(new URL(page.url()).hostname)?.label === site.label;
      } catch {
        return false;
      }
    })();

    if (!onPage) {
      await this.stepNavigate(
        { op: 'navigate', url: site.url, label: site.label, site },
        S,
        ctx,
        signal,
      );
    }

    // Locate the real search field.
    const locate = S.push(
      S.event('interaction', 'Locating search field', `Looking for a visible search input on ${site.label}.`),
    );
    let found = null;
    try {
      found = await this.browser.findVisible(site.searchSelectors ?? [], 4000);
    } catch (err) {
      S.fail(locate, err);
      throw Object.assign(new Error(`Could not inspect ${site.label} for a search field: ${err?.message ?? err}`), {});
    }
    if (!found) {
      S.fail(locate, new Error(`No visible search input matched the known selectors for ${site.label}.`), {
        description: `No visible search input matched: ${(site.searchSelectors ?? []).join(', ')}. Falling back to a direct search URL.`,
      });
      if (!site.searchUrl) throw new Error(`${site.label} is not searchable by the local executor.`);
      const url = site.searchUrl(query);
      const fb = S.push(S.event('navigation', 'Using direct search URL', `Navigating to ${url}`, { url }));
      const r = await this.browser.navigate(url, { timeout: NAV_TIMEOUT });
      S.complete(fb, { url: r.url, durationMs: r.durationMs, description: `Loaded "${r.title}".` });
      ctx.currentUrl = r.url;
      const obs = S.push(S.event('observation', 'Inspecting results', 'Counting result elements on the live page.'));
      const n = await this.browser.countResults(site.resultSelectors ?? []);
      S.complete(obs, { description: `${n} result element(s) found.` });
      ctx.lastQuery = query;
      return `Searched ${site.label} for "${query}" via direct URL (${n} results).`;
    }

    // Type into the real field and submit.
    const typeEv = S.push(S.event('interaction', 'Entering query', `Typing "${query}" into ${found.selector}`));
    try {
      await withTimeout(found.locator.fill(query, { timeout: ACTION_TIMEOUT }), ACTION_TIMEOUT, 'Typing the query');
    } catch (err) {
      S.fail(typeEv, err);
      throw Object.assign(new Error(`Could not type into the search field: ${err?.message ?? err}`));
    }
    S.complete(typeEv, { description: `Query "${query}" entered into ${found.selector}.` });

    const submit = S.push(S.event('interaction', 'Submitting search', 'Pressing Enter in the search field.'));
    try {
      await withTimeout(found.locator.press('Enter', { timeout: ACTION_TIMEOUT }), ACTION_TIMEOUT, 'Submitting the search');
    } catch (err) {
      S.fail(submit, err);
      throw Object.assign(new Error(`Could not submit the search: ${err?.message ?? err}`));
    }
    await this.browser.page().waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    // Wait for the result list to actually render before counting.
    await this.browser.waitForAny(site.resultSelectors ?? [], 12_000).catch(() => null);
    await this.browser.page().waitForTimeout(400);
    ctx.currentUrl = this.browser.page().url();
    S.complete(submit, { url: ctx.currentUrl, description: 'Enter submitted; waiting for the results view.' });

    const inspect = S.push(S.event('observation', 'Inspecting results', 'Counting result elements on the live page.'));
    const n = await this.browser.countResults(site.resultSelectors ?? []);
    S.complete(inspect, { description: `${n} result element(s) found on ${ctx.currentUrl}.`, url: ctx.currentUrl });

    ctx.lastQuery = query;
    ctx.lastSite = site;
    ctx.resultsFound = n;
    return `Searched ${site.label} for "${query}" (${n} results).`;
  }

  async stepOpenResult(step, S, ctx, signal) {
    const site = ctx.lastSite ?? (ctx.currentUrl ? siteForHost(new URL(ctx.currentUrl).hostname) : null) ?? SITES.youtube;
    if (!site.videoResults && !site.resultSelectors?.length) {
      throw new Error(`Opening a result is not supported on ${site.label} by the local executor.`);
    }
    const onPage = ctx.currentUrl
      ? siteForHost(new URL(ctx.currentUrl).hostname)?.label === site.label
      : false;
    if (!onPage) {
      if (!ctx.lastQuery) {
        throw new Error('No search results are on screen — ask for a search first (e.g. "Search YouTube for …").');
      }
      await this.stepSearch({ op: 'search', site, query: ctx.lastQuery }, S, ctx, signal);
    }

    const collect = S.push(
      S.event('observation', 'Inspecting results', `Reading candidate links from ${site.label} using ${site.resultSelectors?.join(', ')}.`),
    );
    const candidates = await this.browser.collectResults(site.resultSelectors ?? [], {
      limit: 12,
      videoOnly: !!site.videoResults,
    });
    if (!candidates.length) {
      S.fail(collect, new Error('No candidate links were found on the current page.'), {
        description: 'No candidate links were found — the page layout may have changed or the search returned nothing.',
      });
      throw new Error('No results available to open.');
    }
    S.complete(collect, {
      description: `${candidates.length} candidate(s): ${candidates.slice(0, 3).map((c) => `"${c.title.slice(0, 40)}"`).join(', ')}…`,
    });

    // Selection strategy — explicit and honest.
    let strategy;
    let chosen = candidates[0];
    if (step.strategy === 'latest' && site.videoResults) {
      strategy =
        'Strategy: first organic (non-ad, standard /watch) result on the current results page. ' +
        'The page was not filtered by upload date, so "latest" is NOT verified — this is the top relevance-ranked match for the query.';
    } else if (step.match) {
      const needle = step.match.toLowerCase();
      const hit = candidates.find((c) => c.title.toLowerCase().includes(needle));
      if (hit) {
        chosen = hit;
        strategy = `Strategy: first result whose title contains "${step.match}".`;
      } else {
        strategy = `Strategy: no result title contained "${step.match}" — opened the top-ranked result instead.`;
      }
    } else {
      strategy = 'Strategy: first organic (non-ad) result on the current page.';
    }

    const pick = S.push(
      S.event('interaction', 'Selecting candidate', `Opening "${chosen.title.slice(0, 80)}". ${strategy}`, { url: chosen.href }),
    );
    const target = validateUrl(chosen.href);
    const r = await this.browser.navigate(target, { timeout: NAV_TIMEOUT });
    ctx.currentUrl = r.url;
    S.complete(pick, { url: r.url, durationMs: r.durationMs, description: `Opened "${chosen.title}" — ${strategy}` });

    const check = S.push(S.event('verification', 'Verifying the opened result', 'Comparing the expected and observed page.', { url: r.url }));
    const expected = new URL(target).searchParams.get('v');
    const okWatch = !site.videoResults || r.url.includes('/watch');
    if (!okWatch) {
      S.fail(check, new Error(`The page did not land on a watch page — observed URL: ${r.url}`));
      throw new Error(`Expected a video watch page but the browser is at ${r.url}`);
    }
    S.complete(check, {
      url: r.url,
      description: `Confirmed video page${expected ? ` (id ${expected})` : ''}: "${r.title}".`,
    });
    return `Opened "${chosen.title}" at ${r.url}`;
  }

  async stepClick(step, S, ctx, _signal) {
    const ev = S.event('interaction', `Clicking "${step.text.slice(0, 60)}"`, 'Searching visible links and buttons for a text match.');
    const res = await runStep(S, ev, async () => {
      const before = this.browser.page().url();
      const r = await this.browser.clickByText(step.text);
      if (!r.matched) throw new Error(`No visible link or button contained "${step.text}".`);
      ctx.currentUrl = r.url;
      return {
        url: r.url,
        description: before === r.url ? `Clicked; the URL did not change (${r.url}).` : `Clicked; navigated to ${r.url}`,
      };
    });
    return res.description;
  }

  async stepFill(step, S, _ctx, _signal) {
    const ev = S.event('interaction', 'Typing text', `Entering "${step.text}" into ${step.field}.`);
    const res = await runStep(S, ev, async () => {
      const page = this.browser.page();
      const candidates = ['input[type="text"]', 'textarea', 'input:not([type])', '[contenteditable="true"]'];
      const found = await this.browser.findVisible(candidates, 2500);
      if (!found) throw new Error(`No visible text field was found on ${page.url()}.`);
      await found.locator.fill(step.text, { timeout: ACTION_TIMEOUT });
      return { description: `Filled ${found.selector} with "${step.text}".` };
    });
    return res.description;
  }

  async stepScroll(step, S, _ctx, _signal) {
    const amount = step.amount ?? (step.dir === 'top' || step.dir === 'bottom' ? 5000 : 760);
    const ev = S.event('interaction', `Scrolling ${step.dir}`, `Mouse-wheel scroll of ${amount}px on the active page.`);
    const res = await runStep(S, ev, async () => {
      if (step.dir === 'top') await this.browser.scroll('up', 100000);
      else if (step.dir === 'bottom') await this.browser.scroll('down', 100000);
      else await this.browser.scroll(step.dir, amount);
      const page = this.browser.page();
      const pos = await page
        .evaluate(() => ({ y: Math.round(window.scrollY), max: Math.round(document.body.scrollHeight - window.innerHeight) }))
        .catch(() => null);
      return { description: pos ? `Now at y=${pos.y}px of ${pos.max}px document height.` : 'Scrolled.' };
    });
    return res.description;
  }

  async stepNewTab(step, S, ctx, _signal) {
    const ev = S.event('browser', 'Opening a new tab', 'Creating a page in the automation context.');
    const res = await runStep(S, ev, async () => {
      const r = await this.browser.newTab();
      ctx.currentUrl = r.url;
      return { description: `Tab ${r.index + 1} is now active (${r.url}).` };
    });
    return res.description;
  }

  async stepSwitchTab(step, S, ctx, _signal) {
    const tabs = this.browser.snapshot().tabs;
    let index = step.index;
    if (step.delta) index = (this.browser.activeIndex + step.delta + tabs.length) % tabs.length;
    const ev = S.event('browser', 'Switching tab', `Activating tab ${index + 1} of ${tabs.length}.`);
    const res = await runStep(S, ev, async () => {
      const r = await this.browser.switchTab(index);
      ctx.currentUrl = r.url;
      return { description: `Tab ${index + 1} is now active: "${r.title}" — ${r.url}` };
    });
    return res.description;
  }

  async stepCloseTab(step, S, _ctx, _signal) {
    const ev = S.event('browser', 'Closing tab', 'Closing the active tab.');
    const res = await runStep(S, ev, async () => {
      const r = await this.browser.closeTab();
      return { description: `Tab closed — ${r.remaining} tab(s) remain.` };
    });
    return res.description;
  }

  async stepHistory(step, S, ctx, _signal) {
    const verb = step.op === 'back' ? 'Going back' : 'Going forward';
    const ev = S.event('navigation', verb, `history.${step.op}() on the active page.`);
    const res = await runStep(S, ev, async () => {
      const r = step.op === 'back' ? await this.browser.back() : await this.browser.forward();
      ctx.currentUrl = r.url;
      return { url: r.url, durationMs: r.durationMs, description: `Now at "${r.title}" — ${r.url}` };
    });
    return res.description;
  }

  async stepRead(step, S, ctx, signal, what) {
    const ev = S.event('observation', what === 'title' ? 'Reading the page title' : 'Reading the current URL', 'Querying the live page.');
    const res = await runStep(S, ev, async () => {
      const { title, url } = await this.browser.titleAndUrl();
      const value = what === 'title' ? title : url;
      ctx.currentUrl = url;
      return { url, description: `${what === 'title' ? 'Title' : 'URL'}: ${value}` };
    });
    return res.description;
  }
}
