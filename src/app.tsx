import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import Home from "@/routes/home";
import SiteLayout from "@/routes/site-layout";
import Crawls from "@/routes/crawls";
import CrawlRun from "@/routes/crawl-run";
import Pages from "@/routes/pages";
import PageDetail from "@/routes/page-detail";
import Issues from "@/routes/issues";
import RuleDetail from "@/routes/rule-detail";
import Settings from "@/routes/settings";
import Analytics from "@/routes/analytics";
import SectionPlaceholder from "@/routes/section-placeholder";
import { NotFound } from "@/routes/not-found";

// Every route of the prototype. Static segments win over :section, so /:site/:section only catches the placeholders.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<Home />} />
        <Route path=":site" element={<SiteLayout />}>
          <Route path="overview" element={<Navigate to="../analytics" replace />} />
          <Route path="crawls" element={<Crawls />} />
          <Route path="crawls/:crawlId" element={<CrawlRun />} />
          <Route path="pages" element={<Pages />} />
          <Route path="pages/:pageId" element={<PageDetail />} />
          <Route path="issues" element={<Issues />} />
          <Route path="issues/:ruleId" element={<RuleDetail />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="settings" element={<Settings />} />
          <Route path=":section" element={<SectionPlaceholder />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
