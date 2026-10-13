import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "DocMind — AI Document Intelligence",
  description:
    "RAG knowledge base with hybrid retrieval, re-ranking, and citation-backed answers that refuse honestly.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
