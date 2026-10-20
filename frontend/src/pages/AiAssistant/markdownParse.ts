/** The small part of Markdown the AI Assistant writes - headings, lists, tables, code, bold / italic /
 * inline code - parsed into plain data. Markdown.tsx turns it into React elements, so nothing the
 * model writes is ever inserted as HTML. */

export type Inline = { kind: 'text' | 'bold' | 'italic' | 'code'; text: string }

export type Block =
  | { kind: 'heading'; level: number; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'code'; text: string }

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  for (const part of text.split(INLINE)) {
    if (!part) continue
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      out.push({ kind: 'bold', text: part.slice(2, -2) })
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      out.push({ kind: 'code', text: part.slice(1, -1) })
    } else if (part.length > 2 && ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_')))) {
      out.push({ kind: 'italic', text: part.slice(1, -1) })
    } else {
      out.push({ kind: 'text', text: part })
    }
  }
  return out
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => parseInline(c.trim()))
const isTableRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)
const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join(' ')) })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().startsWith('```')) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) code.push(lines[i])
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: Math.min(heading[1].length, 4), content: parseInline(heading[2]) })
      continue
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      flush()
      const header = cells(line)
      const rows: Inline[][][] = []
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]))
      i--
      blocks.push({ kind: 'table', header, rows })
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (bullet || numbered) {
      flush()
      const ordered = !bullet
      const pattern = ordered ? NUMBERED : BULLET
      const items: Inline[][] = []
      for (; i < lines.length; i++) {
        const match = pattern.exec(lines[i])
        if (!match) break
        items.push(parseInline(match[1]))
      }
      i--
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    if (!line.trim()) flush()
    else paragraph.push(line.trim())
  }
  flush()
  return blocks
}
