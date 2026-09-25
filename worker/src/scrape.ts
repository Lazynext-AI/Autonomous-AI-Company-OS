// Cloudflare Browser Rendering scrape — headless Chromium extracts a page's
// main content for agent research.
import puppeteer from "@cloudflare/puppeteer";
import { Env, json } from "./gateway";

type Brw = Awaited<ReturnType<typeof puppeteer.launch>>;

// Fresh browser launches are the dominant render cost (cold pool starts
// measured at ~60s). Reuse an idle session when one exists, and launch with
// keep_alive so disconnect leaves the browser warm for the next request.
async function launchBrowser(browser: NonNullable<Env["BROWSER"]>): Promise<Brw> {
  const sessions = (await puppeteer.sessions(browser).catch(() => [])) as {
    sessionId?: string;
    connectionId?: string | null;
  }[];
  const idle = sessions.find((s) => s.sessionId && !s.connectionId);
  if (idle?.sessionId) {
    const b = await puppeteer.connect(browser, idle.sessionId).catch(() => null);
    if (b) return b;
  }
  return puppeteer.launch(browser, { keep_alive: 120_000 });
}

// Release the websocket but leave the session running (keep_alive) so a later
// request can reconnect instead of paying a cold launch.
async function releaseBrowser(browser: Brw | undefined) {
  if (!browser) return;
  await browser.disconnect().catch(() => browser.close().catch(() => {}));
}

export async function handleScrape(req: Request, env: Env): Promise<Response> {
  const { url, max_chars = 6000 } = (await req.json()) as { url?: string; max_chars?: number };
  if (!url || !/^https?:\/\//i.test(url)) return json({ error: "valid url required" }, 400);
  if (!env.BROWSER) return json({ error: "browser binding not configured" }, 503);

  let browser;
  try {
    browser = await launchBrowser(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const data = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      for (const el of Array.from(doc.querySelectorAll("script,style,nav,header,footer,aside,form,noscript,iframe")))
        (el as any).remove();
      const main = doc.querySelector("main,article,[role=main]") ?? doc.body;
      return {
        title: doc.title as string,
        text: String((main as any).innerText).replace(/\n{3,}/g, "\n\n").trim(),
        url: (globalThis as any).location.href as string,
      };
    });
    return json({
      title: data.title,
      url: data.url,
      markdown: `# ${data.title}\n\n${data.text}`.slice(0, max_chars),
      chars: data.text.length,
      provider: "cloudflare-browser",
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e), provider: "cloudflare-browser" }, 502);
  } finally {
    await releaseBrowser(browser);
  }
}

// Render a URL to PDF via Browser Rendering (page.pdf) — used for report exports.
export async function handlePdf(req: Request, env: Env): Promise<Response> {
  const { url } = (await req.json()) as { url?: string };
  if (!url || !/^https?:\/\//i.test(url)) return json({ error: "valid url required" }, 400);
  if (!env.BROWSER) return json({ error: "browser binding not configured" }, 503);

  let browser;
  try {
    browser = await launchBrowser(env.BROWSER);
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    const pdf = await page.pdf({ printBackground: true });
    return new Response(pdf, { headers: { "content-type": "application/pdf" } });
  } catch (e: any) {
    return json({ error: e instanceof Error ? e.message : String(e), provider: "cloudflare-browser" }, 502);
  } finally {
    await releaseBrowser(browser);
  }
}

// Rendered-page extraction for the product API — returns the full rendered
// HTML plus computed text styles so the scanner can check REAL contrast
// (post-CSS) instead of guessing from markup.
export async function handleRender(req: Request, env: Env): Promise<Response> {
  const { url } = (await req.json()) as { url?: string };
  if (!url || !/^https?:\/\//i.test(url)) return json({ error: "valid url required" }, 400);
  if (!env.BROWSER) return json({ error: "browser binding not configured" }, 503);

  let browser;
  try {
    browser = await launchBrowser(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const data = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const win = (globalThis as any).window;
      const styles: unknown[] = [];
      const els = doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p,a,span,li,td,th,label,button");
      for (const el of Array.from(els).slice(0, 250) as any[]) {
        const cs = win.getComputedStyle(el);
        const text = String((el as any).innerText ?? "").trim().slice(0, 60);
        if (!text) continue;
        styles.push({
          tag: String(el.tagName).toLowerCase(),
          text,
          color: cs.color,
          bg: cs.backgroundColor,
          size: parseFloat(cs.fontSize),
          weight: cs.fontWeight,
          td: cs.textDecorationLine,
          // 1.4.1 is scoped to links inside body text — a nav menu link is
          // identifiable as a link by structure, not color. inProse marks
          // links sitting inside a text-bearing block that is not inside
          // nav/header/footer furniture.
          inProse:
            el.tagName === "A" &&
            !!(el as any).closest("p,li,td,dd,blockquote") &&
            !(el as any).closest("nav,header,footer"),
        });
      }
      // Static facts that need a real DOM (not regex): iframe titles, duplicate
      // ids, aria-hidden focusables, autofocus, noopener, media captions.
      const facts = {
        iframesNoTitle: doc.querySelectorAll('iframe:not([title])').length,
        duplicateIds: (() => {
          const seen = new Set(); let dup = 0;
          for (const el of Array.from(doc.querySelectorAll('[id]') as any)) {
            const id = (el as any).id;
            if (seen.has(id)) dup++; else seen.add(id);
          }
          return dup;
        })(),
        ariaHiddenFocusable: doc.querySelectorAll('[aria-hidden="true"] a[href], [aria-hidden="true"] button, [aria-hidden="true"] input, [aria-hidden="true"] [tabindex]').length,
        autofocus: doc.querySelectorAll('[autofocus]').length,
        blankNoopener: doc.querySelectorAll('a[target="_blank"]:not([rel*="noopener"])').length,
        mediaNoCaptions: doc.querySelectorAll('video:not([aria-label]):not(:has(track)), audio:not([aria-label]):not(:has(track))').length,
        tablesNoHeaders: Array.from(doc.querySelectorAll('table') as any).filter((t: any) => !t.querySelector('th')).length,
        skipLink: !!doc.querySelector('a[href^="#main"], a[href^="#content"]'),
      };
      return {
        title: doc.title as string,
        html: String(doc.documentElement.outerHTML),
        styles,
        facts,
      };
    });

    // Interactive check: press Tab through the page and watch where focus
    // lands. A sequence that never moves = keyboard trap; zero focusable
    // elements = keyboard-inaccessible. Also census the focusable elements
    // (so downstream analysis knows what Tab *should* reach) and probe
    // Escape (a dialog that ignores it is a hard trap).
    const focusTrace: string[] = [];
    const backtrace: string[] = [];
    const clickTraps: { trigger: string; focusOutside: boolean; escapeDead: boolean; noExit: boolean }[] = [];
    let focusable = 0;
    let undersized: { d: string; w: number; h: number }[] = [];
    let undersizedAAA: { d: string; w: number; h: number }[] = [];
    const obscured = new Set<string>();
    const noFocusInd = new Set<string>();
    let nontextContrast: { d: string; ratio: number }[] = [];
    let spacingClip: string[] = [];
    let escape: { inDialog: boolean; responds: boolean } | null = null;
    const FOCUSABLE_SEL =
      'a[href],button,input,select,textarea,summary,area[href],video[controls],audio[controls],[tabindex]:not([tabindex="-1"])';
    // Trace entries carry the element's index in the focusable census —
    // labels alone can't distinguish same-text siblings ("Get started" ×5).
    const readFocus = () =>
      page.evaluate((sel) => {
        const doc = (globalThis as any).document;
        const el = doc.activeElement;
        if (!el || el === doc.body) return "body";
        const idx = Array.from(doc.querySelectorAll(sel) as any).indexOf(el);
        const desc = `${String(el.tagName).toLowerCase()}${el.id ? "#" + el.id : ""}${String((el as any).innerText ?? "").trim() ? ":" + String((el as any).innerText).trim().slice(0, 25) : ""}`;
        return `${idx}:${desc}`;
      }, FOCUSABLE_SEL);
    try {
      const census = await page.evaluate((sel) => {
        const doc = (globalThis as any).document;
        const win = (globalThis as any).window;
        let n = 0;
        const under: { d: string; w: number; h: number }[] = [];
        const underAAA: { d: string; w: number; h: number }[] = [];
        Array.from(doc.querySelectorAll(sel) as any).forEach((el: any, idx: number) => {
          const r = el.getBoundingClientRect();
          const cs = win.getComputedStyle(el);
          if (!(r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !el.disabled)) return;
          n++;
          // WCAG 2.5.8 — targets under 24x24px in both dimensions. Exempts
          // inline text links and UA-default checkbox/radio sizing per the
          // criterion's own exceptions.
          const tag = String(el.tagName).toLowerCase();
          const inlineLink = tag === "a" && !!el.closest("p,li,td,blockquote,figcaption");
          const uaSized = tag === "input" && /^(checkbox|radio)$/i.test(String(el.type ?? ""));
          if (r.width < 24 && r.height < 24 && !inlineLink && !uaSized) {
            under.push({ d: `${idx}:${tag}${el.id ? "#" + el.id : ""}`, w: Math.round(r.width), h: Math.round(r.height) });
          }
          // WCAG 2.5.5 (AAA) — targets under 44x44px. The <24px band is already
          // an AA failure (2.5.8); this captures the 24-43px band between them.
          if (r.width < 44 && r.height < 44 && !(r.width < 24 && r.height < 24) && !inlineLink && !uaSized) {
            underAAA.push({ d: `${idx}:${tag}${el.id ? "#" + el.id : ""}`, w: Math.round(r.width), h: Math.round(r.height) });
          }
        });
        return { count: n, under, underAAA };
      }, FOCUSABLE_SEL);
      focusable = census.count;
      undersized = census.under;
      undersizedAAA = census.underAAA;
      // Merged read — one websocket round-trip per Tab press instead of two.
      // WCAG 2.4.11 — a focused element fully covered by author content
      // (sticky header, banner, overlay) is hidden from keyboard users.
      // WCAG 2.4.13 — focus appearance: no outline AND no box-shadow on the
      // focused element means keyboard users can't see where focus is.
      const readFocusProbe = () =>
        page.evaluate((sel) => {
          const doc = (globalThis as any).document;
          const win = (globalThis as any).window;
          const el = doc.activeElement;
          if (!el || el === doc.body || !(el as any).getBoundingClientRect)
            return { entry: "body", hidden: false, noInd: false };
          const idx = Array.from(doc.querySelectorAll(sel) as any).indexOf(el);
          const desc = `${String(el.tagName).toLowerCase()}${el.id ? "#" + el.id : ""}${String((el as any).innerText ?? "").trim() ? ":" + String((el as any).innerText).trim().slice(0, 25) : ""}`;
          const r = (el as any).getBoundingClientRect();
          const hidden = r.width > 0 && r.height > 0
            ? (() => { const top = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && top !== el && !(el as any).contains(top); })()
            : false;
          const cs = win.getComputedStyle(el);
          const noInd = !(parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== "none") && cs.boxShadow === "none";
          return { entry: `${idx}:${desc}`, hidden, noInd };
        }, FOCUSABLE_SEL);
      const seen = new Set<string>();
      let stall = 0;
      let prev = "";
      for (let i = 0; i < 24; i++) {
        await page.keyboard.press("Tab");
        const probe = (await readFocusProbe()) as { entry: string; hidden: boolean; noInd: boolean };
        const entry = probe.entry;
        focusTrace.push(entry);
        if (probe.hidden) obscured.add(entry);
        if (probe.noInd && entry !== "body") noFocusInd.add(entry);
        // Early exits — each press costs a remote round-trip. The rules only
        // need the signature: a ≥4-press stall proves a trap; seeing every
        // focusable proves coverage. Subset cycles never reach full coverage,
        // so they keep the full 24-press window for detection.
        stall = entry === prev ? stall + 1 : 1;
        prev = entry;
        if (entry !== "body") seen.add(entry);
        if (stall >= 4 || (focusable > 0 && seen.size >= focusable)) break;
      }
      // When the census found no focusables or the forward trace already
      // hard-stalled (stall >= 4 — the full trap signature downstream), the
      // Escape/backtrace/click probes below cannot surface any rule the
      // forward trace didn't already flag. Skipping them saves ~20 round
      // trips on keyboard-inaccessible or trapped pages.
      const probesDone = focusable === 0 || stall >= 4;
      if (!probesDone) {
        // Escape probe — before-state and in-dialog merged into one
        // round-trip. Focus on <body> can never be inside a dialog, so the
        // probe is skipped entirely in that case (escape stays null and the
        // downstream check simply doesn't fire).
        const preEsc = (await page.evaluate((sel) => {
          const doc = (globalThis as any).document;
          const el = doc.activeElement;
          const inside = !!(el && (el as any).closest && (el as any).closest('dialog,[role="dialog"]'));
          if (!el || el === doc.body) return { entry: "body", inDialog: inside };
          const idx = Array.from(doc.querySelectorAll(sel) as any).indexOf(el);
          const desc = `${String(el.tagName).toLowerCase()}${el.id ? "#" + el.id : ""}${String((el as any).innerText ?? "").trim() ? ":" + String((el as any).innerText).trim().slice(0, 25) : ""}`;
          return { entry: `${idx}:${desc}`, inDialog: inside };
        }, FOCUSABLE_SEL)) as { entry: string; inDialog: boolean };
        if (preEsc.entry !== "body" || preEsc.inDialog) {
          await page.keyboard.press("Escape");
          escape = { inDialog: preEsc.inDialog, responds: String(await readFocus()) !== preEsc.entry };
        }

        // Backward trace — Shift+Tab retreat from wherever forward focus
        // ended. Regions that let focus in but swallow Shift+Tab are a trap
        // class the forward-only trace cannot see. Early exits mirror the
        // downstream exclusions: reaching 'body' or the first forward-focused
        // element means the retreat completed (neither can be flagged), and a
        // completed 2-cycle tail is the signature findTailCycle needs.
        const firstFwd = focusTrace.find((t) => t !== "body") ?? "";
        try {
          await page.keyboard.down("Shift");
          let bstall = 0;
          let bprev = "";
          for (let i = 0; i < 8; i++) {
            await page.keyboard.press("Tab");
            const e = String(await readFocus());
            backtrace.push(e);
            bstall = e === bprev ? bstall + 1 : 1;
            bprev = e;
            const n = backtrace.length;
            const twoCycle = n >= 6
              && backtrace[n - 1] === backtrace[n - 3] && backtrace[n - 3] === backtrace[n - 5]
              && backtrace[n - 2] === backtrace[n - 4] && backtrace[n - 4] === backtrace[n - 6]
              && backtrace[n - 1] !== backtrace[n - 2];
            if (bstall >= 4 || e === "body" || e === firstFwd || twoCycle) break;
          }
          await page.keyboard.up("Shift");
        } catch {
          await page.keyboard.up("Shift").catch(() => {});
        }
      }

      // Click-activated dialogs — a modal that only exists after a click is
      // invisible to markup scanning and to a plain Tab trace. Click likely
      // triggers; when a dialog/alertdialog actually appears, test whether
      // keyboard users can reach it and exit it. Gated with the other deep
      // probes: with zero focusables no keyboard user can reach a trigger,
      // and after a forward hard-stall the page is already flagged trapped.
      if (!probesDone) try {
        page.on("dialog", (d: any) => d.dismiss().catch(() => {}));
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const openDialog = () =>
          page.evaluate(() => {
            const doc = (globalThis as any).document;
            const win = (globalThis as any).window;
            const dlg = Array.from(doc.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')).find((el: any) => {
              const r = el.getBoundingClientRect();
              const cs = win.getComputedStyle(el);
              return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
            });
            if (!dlg) return null;
            const act = doc.activeElement;
            return {
              inside: !!(act && act !== doc.body && ((dlg as any) === act || (dlg as any).contains(act))),
              controls: (dlg as any).querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])').length,
            };
          });
        const triggers = await page.$$(
          '[aria-haspopup="dialog"],[aria-haspopup="true"],[data-bs-toggle],[data-toggle],[data-target],[data-modal],button',
        );
        for (const h of triggers.slice(0, 4)) {
          const urlBefore = page.url();
          const desc = await page.evaluate((el: any) => {
            const doc = (globalThis as any).document;
            const sel = 'a[href],button,input,select,textarea,summary,area[href],video[controls],audio[controls],[tabindex]:not([tabindex="-1"])';
            const idx = Array.from(doc.querySelectorAll(sel)).indexOf(el);
            const r = el.getBoundingClientRect();
            if (!(r.width > 0 && r.height > 0)) return null;
            // A button inside a form with no/unknown type submits on click —
            // probing it navigates the page rather than opening UI.
            if (el.tagName === "BUTTON" && el.closest("form") && (el.getAttribute("type") ?? "submit") === "submit") return null;
            const txt = String(el.innerText ?? el.getAttribute?.("aria-label") ?? "").trim();
            return `${idx}:${String(el.tagName).toLowerCase()}${el.id ? "#" + el.id : ""}${txt ? ":" + txt.slice(0, 25) : ""}`;
          }, h);
          if (!desc) continue;
          if (await openDialog()) break; // earlier probe left a dialog open — state unrecoverable
          await h.click().catch(() => {});
          await sleep(350);
          if (page.url() !== urlBefore) {
            await page.goBack().catch(() => {});
            continue;
          }
          const opened = await openDialog();
          if (!opened) continue;
          const beforeEscProbe = await readFocus();
          await page.keyboard.press("Escape");
          await sleep(150);
          const still = await openDialog();
          clickTraps.push({
            trigger: desc,
            focusOutside: !opened.inside,
            escapeDead: !!still && String(await readFocus()) === String(beforeEscProbe),
            noExit: opened.controls === 0,
          });
          if (still) {
            // Backdrop click to try dismissing a stuck overlay; if it won't
            // close, further triggers can't be probed meaningfully.
            await page.mouse.click(5, 5).catch(() => {});
            await sleep(150);
            if (await openDialog()) break;
          }
        }
      } catch {}

      // WCAG 1.4.11 (AA) — non-text contrast: an interactive component's
      // visual boundary (border, outline, or fill) must reach 3:1 against
      // the adjacent background or keyboard/sighted users can't see it.
      nontextContrast = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const win = (globalThis as any).window;
        const chan = (rgb: string) => {
          const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
          return { r: m[0] ?? 0, g: m[1] ?? 0, b: m[2] ?? 0, a: m[3] ?? 1 };
        };
        const over = (fg: any, bg: any) => ({
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
        });
        const lum = (c: any) => {
          const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const out: { d: string; ratio: number }[] = [];
        const els = Array.from(doc.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),select,textarea,button,[role="button"],[role="checkbox"],[role="radio"]') as any).slice(0, 200);
        for (const el of els as any[]) {
          const cs = win.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (!(r.width > 0 && r.height > 0) || cs.visibility === "hidden" || cs.display === "none") continue;
          // Adjacent background = nearest non-transparent ancestor fill.
          let bg = { r: 255, g: 255, b: 255 };
          for (let n = el.parentElement; n; n = n.parentElement) {
            const c = chan(win.getComputedStyle(n).backgroundColor);
            if (c.a > 0) { bg = c; break; }
          }
          // Boundary = border, outline, or the element's own fill — any ONE
          // passing 3:1 satisfies the criterion.
          const candidates: any[] = [];
          const bw = parseFloat(cs.borderTopWidth) || 0;
          if (bw > 0 && cs.borderTopStyle !== "none") candidates.push(chan(cs.borderTopColor));
          if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== "none") candidates.push(chan(cs.outlineColor));
          const fill = chan(cs.backgroundColor);
          if (fill.a > 0) candidates.push(fill);
          if (!candidates.length) continue; // no boundary to check
          const best = Math.max(...candidates.map((c) => {
            const e = over(c, bg);
            const l1 = lum(e), l2 = lum(bg);
            return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          }));
          if (best < 3) out.push({ d: `${String(el.tagName).toLowerCase()}${el.id ? "#" + el.id : ""}`, ratio: Math.round(best * 100) / 100 });
          if (out.length >= 8) break;
        }
        return out;
      });

      // WCAG 1.4.12 (AA) — text spacing: applying the criterion's override
      // metrics must not clip content. Delta-only: elements already clipped
      // before the override are the author's existing overflow, not 1.4.12.
      const clipped = () =>
        page.evaluate(() => {
          const doc = (globalThis as any).document;
          const win = (globalThis as any).window;
          const out: string[] = [];
          for (const el of Array.from(doc.querySelectorAll("p,li,td,th,span,a,button,label,h1,h2,h3,h4,h5,h6,div") as any) as any[]) {
            if (!String((el as any).innerText ?? "").trim()) continue;
            const cs = win.getComputedStyle(el);
            if (!/hidden|clip/.test(cs.overflowY)) continue;
            if ((el as any).scrollHeight > (el as any).clientHeight + 2 || (el as any).scrollWidth > (el as any).clientWidth + 2) {
              out.push(`${String((el as any).tagName).toLowerCase()}${(el as any).id ? "#" + (el as any).id : ""}:${String((el as any).innerText).trim().slice(0, 40)}`);
              if (out.length >= 50) break;
            }
          }
          return out;
        });
      const clipBefore = new Set(await clipped());
      await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const st = doc.createElement("style");
        st.textContent = "*,*::before,*::after{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}";
        doc.head.appendChild(st);
      });
      spacingClip = (await clipped()).filter((d) => !clipBefore.has(d)).slice(0, 8);
    } catch {}

    return json({
      url,
      title: data.title,
      html: data.html,
      styles: data.styles,
      facts: data.facts,
      focus: focusTrace,
      backtrace,
      clickTraps,
      focusable,
      undersized,
      undersizedAAA,
      obscured: Array.from(obscured),
      noFocusInd: Array.from(noFocusInd),
      nontextContrast,
      spacingClip,
      escape,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e), provider: "cloudflare-browser" }, 502);
  } finally {
    await releaseBrowser(browser);
  }
}
