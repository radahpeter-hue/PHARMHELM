/** Quote every cell and neutralize spreadsheet formulas in user-provided strings. */
export function toSafeCsv(rows:ReadonlyArray<ReadonlyArray<unknown>>):string {
 return rows.map(row=>row.map(value=>{
  let text=value===null||value===undefined?'':String(value);
  if(typeof value==='string'&&/^\s*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
 }).join(',')).join('\r\n');
}
