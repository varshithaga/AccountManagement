/** POST /transactions/finalize/ - final transactions are posted to the journal (the books) unless they
 * are already matched to a journal line in Bank Reconciliation. */
export interface FinalizeResult {
  finalized: number
  already_final: number
  not_ready: number
  posting?: {
    posted: number
    already_in_books: number
    no_gl_account: number
    not_categorized: number
    locked: number
    duplicate: number
  }
}

/** The alert text after making transactions final. */
export function describeFinalize(res: FinalizeResult): string {
  const parts = [`${res.finalized} transaction(s) made final.`]
  if (res.already_final) parts.push(`${res.already_final} were already final.`)
  if (res.not_ready) parts.push(`${res.not_ready} skipped - still Needs Review or Uncategorized; categorize them first.`)
  const p = res.posting
  if (p) {
    if (p.posted) parts.push(`${p.posted} posted to the books (journal).`)
    if (p.already_in_books) parts.push(`${p.already_in_books} already in the books through a matched journal entry.`)
    if (p.no_gl_account) {
      parts.push(`${p.no_gl_account} not posted - the bank account has no GL account. Link one on Bank Accounts, `
        + 'then use "Post to books" in the General Ledger.')
    }
    if (p.locked) parts.push(`${p.locked} not posted - dated in a closed or reconciled period.`)
  }
  return parts.join('\n')
}
