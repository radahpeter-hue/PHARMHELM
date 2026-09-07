from pathlib import Path
p = Path('src/types.ts')
text = p.read_text()
old = "  welfareAmount?: number;\n  cashierId: string;"
new = "  welfareAmount?: number;\n  welfareBeneficiaryIsStaff?: boolean;\n  welfarePostingStatus?: 'pending' | 'posted' | 'reversed' | 'not_applicable';\n  welfarePostingId?: string;\n  welfarePostingAmount?: number;\n  welfarePostingUpdatedAt?: unknown;\n  sourceQuotationId?: string;\n  quotationConversionStatus?: 'pending' | 'converted' | 'not_applicable';\n  quotationConvertedAt?: string;\n  cashierId: string;"
if old not in text:
    raise RuntimeError('Sale finance metadata type anchor not found')
p.write_text(text.replace(old, new, 1))
print('patched Sale finance metadata types')
