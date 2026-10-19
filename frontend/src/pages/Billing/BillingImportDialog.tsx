import { useMemo } from 'react'
import ImportExcelDialog from '../../components/ImportExcelDialog'
import { importConfig } from './billingImport'
import type { ImportRow, ImportTarget } from './billingImport'

/** "Import from Excel" for clients, suppliers or products - template download, row check, then all-or-nothing import. */
export default function BillingImportDialog({ target, open, onClose, onImported }: {
  target: ImportTarget
  open: boolean
  onClose: () => void
  onImported: () => void
}) {
  const config = useMemo(() => importConfig(target), [target])
  return (
    <ImportExcelDialog<ImportRow>
      open={open}
      onClose={onClose}
      instructions={`One ${config.itemLabel} per row. See the column and row guide below.`}
      onImported={onImported}
      {...config}
    />
  )
}
