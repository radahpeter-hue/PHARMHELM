from pathlib import Path

path = Path('src/components/inventory/ProductModal.tsx')
text = path.read_text()

cosmetic_anchor = '''      <div className="space-y-1">
        <label className="text-[10px] font-black text-pink-700 uppercase tracking-wider">Units per Pack</label>
        <input
          type="number"
          className="w-full px-3 py-2 bg-white border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-500/20 outline-none text-sm"
          value={isNaN(formData.unitsPerPack as number) ? '' : formData.unitsPerPack || 0}
          onChange={e => setFormData({ ...formData, unitsPerPack: parseFloat(e.target.value) || 0 })}
        />
      </div>
'''
cosmetic_replacement = cosmetic_anchor + '''      <div className="space-y-1">
        <label className="text-[10px] font-black text-pink-700 uppercase tracking-wider">Units per Strip</label>
        <input
          type="number"
          min="0"
          className="w-full px-3 py-2 bg-white border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-500/20 outline-none text-sm"
          value={isNaN(formData.unitsPerStrip as number) ? '' : formData.unitsPerStrip || 0}
          onChange={e => setFormData({ ...formData, unitsPerStrip: parseFloat(e.target.value) || 0 })}
        />
      </div>
'''

consumable_anchor = '''      <div className="space-y-1">
        <label className="text-[10px] font-black text-blue-700 uppercase tracking-wider">Units per Pack</label>
        <input
          type="number"
          className="w-full px-3 py-2 bg-white border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
          value={isNaN(formData.unitsPerPack as number) ? '' : formData.unitsPerPack || 0}
          onChange={e => setFormData({ ...formData, unitsPerPack: parseFloat(e.target.value) || 0 })}
        />
      </div>
'''
consumable_replacement = consumable_anchor + '''      <div className="space-y-1">
        <label className="text-[10px] font-black text-blue-700 uppercase tracking-wider">Units per Strip</label>
        <input
          type="number"
          min="0"
          className="w-full px-3 py-2 bg-white border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
          value={isNaN(formData.unitsPerStrip as number) ? '' : formData.unitsPerStrip || 0}
          onChange={e => setFormData({ ...formData, unitsPerStrip: parseFloat(e.target.value) || 0 })}
        />
      </div>
'''

if 'text-pink-700 uppercase tracking-wider">Units per Strip</label>' not in text:
    if cosmetic_anchor not in text:
        raise SystemExit('Cosmetic Units per Pack anchor not found')
    text = text.replace(cosmetic_anchor, cosmetic_replacement, 1)

if 'text-blue-700 uppercase tracking-wider">Units per Strip</label>' not in text:
    if consumable_anchor not in text:
        raise SystemExit('Consumable Units per Pack anchor not found')
    text = text.replace(consumable_anchor, consumable_replacement, 1)

path.write_text(text)
print('Non-tablet strip packaging fields applied.')
