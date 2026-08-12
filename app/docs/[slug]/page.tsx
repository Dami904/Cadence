import type { Metadata } from "next";
import { DocsArticle } from "../../../components/DocsArticle";
import { findDocPage } from "../../../lib/docsContent";

// No generateStaticParams here — this route renders through DocsArticle, which pulls in the
// wallet-connect providers tree, and a static-generation pass tries to evaluate that in a Node
// worker with no `indexedDB` (a browser-only API WalletConnect's core touches at module load).
// Plain per-request SSR, same as app/circle/[address], sidesteps that entirely.

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = findDocPage(slug);
  if (!page) return { title: "Docs — Cadence" };
  return { title: `${page.title} — Cadence Docs`, description: page.description };
}

export default async function DocsSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <DocsArticle slug={slug} />;
}
