// Cloudflare Browser Rendering scrape — headless Chromium extracts a page's
// main content for agent research.
import puppeteer from "@cloudflare/puppeteer";
import { Env, json } from "./gateway";

export async function handleScrape(req: Request, env: Env): Promise<Response> {
  const { url, max_chars = 6000 } = (await req.json()) as { url?: string; max_chars?: number };
  if (!url || !/^https?:\/\//i.test(url)) return json({ error: "valid url required" }, 400);
  if (!env.BROWSER) return json({ error: "browser binding not configured" }, 503);

  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
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
    if (browser) await browser.close().catch(() => {});
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
    browser = await puppeteer.launch(env.BROWSER);
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
    let focusable = 0;
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
      focusable = await page.evaluate((sel) => {
        const doc = (globalThis as any).document;
        const win = (globalThis as any).window;
        let n = 0;
        for (const el of Array.from(doc.querySelectorAll(sel) as any)) {
          const r = (el as any).getBoundingClientRect();
          const cs = win.getComputedStyle(el);
          if (r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !(el as any).disabled) n++;
        }
        return n;
      }, FOCUSABLE_SEL);
      for (let i = 0; i < 24; i++) {
        await page.keyboard.press("Tab");
        focusTrace.push(String(await readFocus()));
      }
      const beforeEsc = await readFocus();
      const inDialog = await page.evaluate(() => {
        const el = (globalThis as any).document.activeElement;
        return !!(el && (el as any).closest && (el as any).closest('dialog,[role="dialog"]'));
      });
      await page.keyboard.press("Escape");
      escape = { inDialog, responds: String(await readFocus()) !== String(beforeEsc) };
    } catch {}

    return json({
      url,
      title: data.title,
      html: data.html,
      styles: data.styles,
      facts: data.facts,
      focus: focusTrace,
      focusable,
      escape,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e), provider: "cloudflare-browser" }, 502);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
