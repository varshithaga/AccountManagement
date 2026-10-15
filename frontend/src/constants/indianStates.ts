/** States and union territories with their GST state codes (the first two digits of a GSTIN).
 * The state decides GST: a party in the company's own state pays CGST + SGST, any other IGST -
 * so it is picked from this list rather than typed. */
export const GST_STATES: { code: string; name: string }[] = [
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '18', name: 'Assam' },
  { code: '10', name: 'Bihar' },
  { code: '04', name: 'Chandigarh' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '07', name: 'Delhi' },
  { code: '30', name: 'Goa' },
  { code: '24', name: 'Gujarat' },
  { code: '06', name: 'Haryana' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '20', name: 'Jharkhand' },
  { code: '29', name: 'Karnataka' },
  { code: '32', name: 'Kerala' },
  { code: '38', name: 'Ladakh' },
  { code: '31', name: 'Lakshadweep' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '27', name: 'Maharashtra' },
  { code: '14', name: 'Manipur' },
  { code: '17', name: 'Meghalaya' },
  { code: '15', name: 'Mizoram' },
  { code: '13', name: 'Nagaland' },
  { code: '21', name: 'Odisha' },
  { code: '34', name: 'Puducherry' },
  { code: '03', name: 'Punjab' },
  { code: '08', name: 'Rajasthan' },
  { code: '11', name: 'Sikkim' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '16', name: 'Tripura' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '19', name: 'West Bengal' },
  { code: '97', name: 'Other Territory' },
]

/** The state a GSTIN is registered in ("29ABCDE1234F1Z5" -> "Karnataka"), or '' when unknown. */
export function stateFromGstin(gstin: string | null | undefined): string {
  const code = (gstin || '').trim().slice(0, 2)
  return GST_STATES.find((s) => s.code === code)?.name ?? ''
}

/** Options for a state dropdown; a saved value that isn't in the list (typed before the list existed) is kept. */
export function stateOptions(current: string): string[] {
  const names = GST_STATES.map((s) => s.name)
  return current && !names.includes(current) ? [current, ...names] : names
}
