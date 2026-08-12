"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, Search, X } from "lucide-react";
import { DOC_PAGES, docGroups, docHref, findDocPage, type DocPage } from "../lib/docsContent";

function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    setActive(ids[0] ?? "");
    const headings = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

function SearchModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOC_PAGES.map((page) => ({ page, section: undefined as string | undefined, anchor: undefined as string | undefined }));
    const out: { page: DocPage; section?: string; anchor?: string }[] = [];
    for (const page of DOC_PAGES) {
      if (page.title.toLowerCase().includes(q) || page.description.toLowerCase().includes(q)) out.push({ page });
      for (const section of page.sections) {
        if (section.title.toLowerCase().includes(q)) out.push({ page, section: section.title, anchor: section.id });
      }
    }
    return out;
  }, [query]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div
      className="doc-search-overlay"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "Enter" && results.length > 0) {
          const r = results[0];
          go(docHref(r.page) + (r.anchor ? `#${r.anchor}` : ""));
        }
      }}
    >
      <div className="doc-search" role="dialog" aria-label="Search docs" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="doc-search-input"
          placeholder="Search docs…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="doc-search-results">
          {results.length === 0 && <li className="doc-search-empty">No matches.</li>}
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => go(docHref(r.page) + (r.anchor ? `#${r.anchor}` : ""))}>
                <b>{r.page.title}</b>
                {r.section ? <span> › {r.section}</span> : <span className="muted"> — {r.page.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function DocsArticle({ slug }: { slug: string }) {
  const page = findDocPage(slug) ?? DOC_PAGES[0];
  const groups = docGroups();
  const idx = DOC_PAGES.indexOf(page);
  const prev = idx > 0 ? DOC_PAGES[idx - 1] : undefined;
  const next = idx < DOC_PAGES.length - 1 ? DOC_PAGES[idx + 1] : undefined;

  const sectionIds = useMemo(() => page.sections.map((s) => s.id), [page]);
  const activeId = useScrollSpy(sectionIds);
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [page]);

  return (
    <div className="docs-page">
      <nav className="docs-topbar">
        <div className="docs-topbar-inner">
          <Link href="/welcome" className="brand-row brand-link">
            <div className="brand-mark"><span>c</span></div>
            <span className="brand-name">cadence</span>
          </Link>
          <button type="button" className="doc-search-btn" onClick={() => setSearchOpen(true)}>
            <Search size={14} /> <span>Search</span> <kbd>⌘K</kbd>
          </button>
          <button type="button" className="doc-nav-toggle" aria-expanded={navOpen} aria-label="Toggle docs navigation" onClick={() => setNavOpen((open) => !open)}>
            {navOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
          <Link href="/connect" className="landing-cta docs-launch">Launch app</Link>
        </div>
      </nav>

      <div className="docs-shell">
        <aside className={`docs-sidebar${navOpen ? " open" : ""}`}>
          {groups.map((group) => (
            <div key={group.label} className="docs-group">
              <div className="docs-group-label">{group.label}</div>
              {group.pages.map((p) => (
                <Link key={p.slug} href={docHref(p)} className={p === page ? "active" : ""} aria-current={p === page ? "page" : undefined}>
                  {p.title}
                </Link>
              ))}
            </div>
          ))}
        </aside>

        <article className="docs-article">
          <p className="docs-crumb">{page.group}<span>/</span>{page.title}</p>
          <h1>{page.title}</h1>
          <p className="docs-lede">{page.description}</p>

          {page.sections.map((section) => (
            <section key={section.id} className="docs-section">
              <h2 id={section.id}>
                {section.title}
                <a href={`#${section.id}`} className="docs-anchor" aria-label={`Link to ${section.title}`}>#</a>
              </h2>
              {section.body}
            </section>
          ))}

          <footer className="docs-pager">
            {prev ? (
              <Link href={docHref(prev)} className="pager-link prev">
                <small>← Previous</small>
                <b>{prev.title}</b>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={docHref(next)} className="pager-link next">
                <small>Next →</small>
                <b>{next.title}</b>
              </Link>
            ) : (
              <span />
            )}
          </footer>
        </article>

        <aside className="docs-toc">
          <div className="docs-group-label">On this page</div>
          {page.sections.map((section) => (
            <a key={section.id} href={`#${section.id}`} className={section.id === activeId ? "active" : ""}>{section.title}</a>
          ))}
        </aside>
      </div>

      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
