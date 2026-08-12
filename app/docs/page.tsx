import type { Metadata } from "next";
import { DocsArticle } from "../../components/DocsArticle";

export const metadata: Metadata = {
  title: "Docs — Cadence",
  description: "How Cadence works, every KeeperHub workflow behind it, and the engineering notes underneath.",
};

export default function DocsIndexPage() {
  return <DocsArticle slug="" />;
}
