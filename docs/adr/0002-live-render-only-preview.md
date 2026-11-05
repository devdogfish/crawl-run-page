# The page preview is a live render of stored HTML and CSS, not a screenshot

The prototype offered a Screenshot mode next to Live render. We dropped it: a 1280px screenshot plus element boxes for every page costs roughly 10–20 GB per ~50K-page crawl and slows the crawl. Instead the crawler stores each page's rendered HTML (already) and its stylesheets (content-addressed, a few MB per crawl), and the preview renders those in a sandboxed iframe without scripts; images, video and fonts stream from the crawled site, with placeholders when they no longer load.

## Consequences

- Crawls made under this decision have no screenshots, so a Screenshot mode added later would only work for crawls after that point.
- Script bodies aren't stored: the iframe never runs JavaScript, and the rendered DOM already contains its effects.
