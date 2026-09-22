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
