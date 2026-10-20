import { Fragment } from 'react'
import { parseMarkdown, type Inline } from './markdownParse'

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'bold') return <strong key={i} className="font-semibold text-ink">{p.text}</strong>
        if (p.kind === 'italic') return <em key={i}>{p.text}</em>
        if (p.kind === 'code') return <code key={i} className="rounded bg-surface-muted px-1 py-0.5 text-[0.85em]">{p.text}</code>
        return <Fragment key={i}>{p.text}</Fragment>
      })}
    </>
  )
}

/** An AI Assistant answer: its Markdown as React elements (never as HTML). */
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2.5 text-sm leading-relaxed text-ink">
      {parseMarkdown(text).map((block, i) => {
        switch (block.kind) {
          case 'heading':
            return <p key={i} className="font-display font-semibold text-ink"><Inlines parts={block.content} /></p>
          case 'paragraph':
            return <p key={i}><Inlines parts={block.content} /></p>
          case 'code':
            return <pre key={i} className="overflow-x-auto rounded-xl bg-surface-muted p-3 text-xs">{block.text}</pre>
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul'
            return (
              <List key={i} className={`flex flex-col gap-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
                {block.items.map((item, j) => <li key={j}><Inlines parts={item} /></li>)}
              </List>
            )
          }
          case 'table':
            return (
              <div key={i} className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-surface-muted">
                      {block.header.map((cell, j) => (
                        <th key={j} className="px-3 py-2 text-left font-semibold text-ink"><Inlines parts={cell} /></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j} className="border-t border-border">
                        {row.map((cell, k) => <td key={k} className="px-3 py-2 align-top"><Inlines parts={cell} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </div>
  )
}
