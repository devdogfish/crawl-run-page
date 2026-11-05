# Crawler

An internal tool that crawls the RBC websites, checks every page against accessibility, SEO, performance and security rules, and helps developers find and fix what fails.

## Language

### Crawling

**Site**:
One website the tool crawls, such as RBC Capital Markets. Each has its own crawl history.
_Avoid_: domain, property, project

**Environment**:
Which copy of a site a crawl targets: Production or QA.
_Avoid_: stage, staging, dev

**Crawl**:
One run of the crawler over one environment of a site, producing a snapshot of every page it found.
_Avoid_: run, scan, job

**Step**:
One stage of a crawl, such as discovery, fetching, or the Lighthouse audit.
_Avoid_: stage, task, phase

**Baseline**:
An older crawl that another crawl is compared against.
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

### Ownership

**Shared markup**:
HTML that appears unchanged on many pages, such as the header or footer.
_Avoid_: global component, boilerplate

**Owner**:
Who fixes an element: code (a component), template (shared markup), or content (an editor in the CMS).
_Avoid_: team, assignee

**Source**:
The thing that produced an element: a component, a template file, or a content record.
_Avoid_: origin, location

**Component**:
A TeamSite LiveSite component on a page, the block wrapped in an `iw_component` container.
_Avoid_: widget, module, block

**Content record**:
A TeamSite data content record (DCR) whose fields hold a page's editable content.
_Avoid_: DCR (in prose), entry, document
