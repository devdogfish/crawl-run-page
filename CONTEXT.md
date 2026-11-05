# Crawler

An internal tool that crawls the RBC websites, checks every page against accessibility, SEO, performance and security rules, and helps developers find and fix what fails.

## Language

### Crawling

**Site**:
One website the tool crawls, such as RBC Capital Markets. Each has its own crawl history. A QA copy (www.sterbccm.com) is a separate site: it holds a minimal baseline of content for testing new components and isn't updated with new content, so it's never compared with production.
_Avoid_: domain, property, project

**Crawl**:
One run of the crawler over a site, producing a snapshot of every page it found.
_Avoid_: run, scan, job

**Step**:
One stage of a crawl, such as discovery, fetching, or the Lighthouse audit.
_Avoid_: stage, task, phase

**Baseline**:
An older crawl of the same site that another crawl is compared against.
_Avoid_: previous crawl, reference, comparison crawl

### Pages

**Page**:
One URL of a site, identified by its normalised path, the same across crawls.
_Avoid_: URL (when meaning the tracked page), document

**Snapshot**:
What one crawl recorded about one page: status, title, content hash.
_Avoid_: page version, capture

**Change**:
How a page differs between a crawl and its baseline: new, changed (content hash differs), removed, or unchanged.
_Avoid_: diff, delta (in the UI)

**Page type**:
The kind of page, decided by its path prefix, such as Article or Podcast.
_Avoid_: template, category

### Issues

**Rule**:
A named check with a fixed severity, category, explanation and fix guidance, from axe-core, Lighthouse, or the team's own checks.
_Avoid_: check, audit, test

**Custom rule**:
A team-defined regular expression counted against each page's HTML; it reports matches, not issues.
_Avoid_: pattern, regex check

**Issue**:
One rule failing on one page in one crawl. It contains one or more elements.
_Avoid_: violation, finding, error

**Element**:
One place on a page where an issue's rule fails, identified by its selector and HTML.
_Avoid_: instance, occurrence, node, target

**Issue status**:
How an element relates to the baseline: new, existing, or fixed (in the baseline, gone now).
_Avoid_: change (that word belongs to pages), state

**Severity**:
How badly a rule failing hurts users: critical, serious, moderate or minor. Set by the rule.
_Avoid_: impact, level

**Priority**:
The team's label for severity: P1 to P4, fixed one to one with severity.
_Avoid_: urgency, rank

**Category**:
The area a rule belongs to: accessibility, performance, SEO, or security and compliance.
_Avoid_: type, area, group

### Where issues are

**Shared markup**:
HTML that appears unchanged on many pages, such as the header or footer. One fix covers every page it's on.
_Avoid_: global component, boilerplate

**Element pattern**:
The selector an issue's elements share once positions are removed, such as `footer .legal a`. The Issues page groups a rule's elements by it.
_Avoid_: group, location, source

The tool doesn't say who owns an element or which CMS field it came from: TeamSite's HTML doesn't expose that reliably, and the preview shows where it is.

### AI

**Navigation**:
The Cmd/Ctrl+K palette that turns what you type into a place in the app: a route and its URL parameters. It never fetches data.
_Avoid_: AI search, command bar

**Ask AI**:
The assistant docked on the right. It explains and fixes from the prompts it's given, and has no tools.
_Avoid_: chatbot, copilot, agent

**Visible prompt**:
What a button such as Fix with AI puts into Ask AI: a short instruction plus the context it's about, all of which the user can see.
_Avoid_: seed (in the UI), hidden context

**Component block**:
A ` ```ui ` block of JSON in an Ask AI answer whose `type` picks the component the app shows, such as `fix`.
_Avoid_: widget, card (in code)

**MCP server**:
The crawler's data for AI tools outside the app, such as Claude Code. Unopinionated and not tied to any screen.
_Avoid_: AI API, plugin

**URL map**:
The one list of routes, URL parameters and their allowed values. Navigation writes URLs from it, and the MCP server and Ask AI build links from it.
_Avoid_: route config, sitemap
