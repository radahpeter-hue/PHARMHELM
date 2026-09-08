from pathlib import Path

path = Path('src/services/posCheckoutTierService.ts')
text = path.read_text()
text = text.replace(
    "import type { SellingTierCode } from '../types/sellingTier';",
    "import type { SellingTierCode, SellingTierFeatureSettings } from '../types/sellingTier';"
)
text = text.replace(
    'settings?: SystemSettings | null;',
    'settings?: SystemSettings | SellingTierFeatureSettings | null;'
)
path.write_text(text)
