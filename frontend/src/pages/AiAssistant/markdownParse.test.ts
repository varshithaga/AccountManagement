import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from './markdownParse'

describe('parseMarkdown', () => {
  it('reads the formatting the assistant writes', () => {
    expect(parseInline('Net **Rs 1,200** for *April*, see `INV-7`')).toEqual([
      { kind: 'text', text: 'Net ' }, { kind: 'bold', text: 'Rs 1,200' }, { kind: 'text', text: ' for ' },
      { kind: 'italic', text: 'April' }, { kind: 'text', text: ', see ' }, { kind: 'code', text: 'INV-7' },
    ])
  })

  it('splits headings, paragraphs, lists and tables', () => {
    const blocks = parseMarkdown([
      '## Overdue invoices', '', 'Two invoices are', 'overdue:', '',
      '| Invoice | Balance |', '|---|---:|', '| INV-1 | 500 |', '| INV-2 | 700 |', '',
      '- first', '- second', '', '1. pay', '2. remind',
    ].join('\n'))
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'table', 'list', 'list'])
    expect(blocks[1]).toEqual({ kind: 'paragraph', content: [{ kind: 'text', text: 'Two invoices are overdue:' }] })
    const table = blocks[2] as Extract<(typeof blocks)[number], { kind: 'table' }>
    expect(table.header.map((c) => c[0].text)).toEqual(['Invoice', 'Balance'])
    expect(table.rows.map((r) => r.map((c) => c[0].text))).toEqual([['INV-1', '500'], ['INV-2', '700']])
    expect(blocks[3]).toMatchObject({ ordered: false, items: [[{ text: 'first' }], [{ text: 'second' }]] })
    expect(blocks[4]).toMatchObject({ ordered: true })
  })

  it('keeps HTML as plain text and code blocks as they are', () => {
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }] },
    ])
    expect(parseMarkdown('```\na | b\n- c\n```')).toEqual([{ kind: 'code', text: 'a | b\n- c' }])
  })
})
