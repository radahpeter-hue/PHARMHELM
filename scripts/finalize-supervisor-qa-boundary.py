from pathlib import Path

path = Path('src/modules/qa/QAModule.tsx')
text = path.read_text()
old = "  const canAccessHQOps = isHQBranch || isExecutive || isCoreQA || isHRHead || isBranchManager;"
new = "  const canAccessHQOps = isHQBranch || isExecutive || isCoreQA || isHRHead || isBranchManager || crossFunctionalAppraisalOnly;"
if old not in text:
    raise SystemExit('QA HQ access target not found')
text = text.replace(old, new, 1)
old_render = """  const renderContent = () => {
    // If somehow a non-authorized user navigates to an HQ tab, block and show secure card
"""
new_render = """  const renderContent = () => {
    // Never render a sub-function that is outside the role-scoped tab set, even for one frame.
    if (!tabs.some(tab => tab.id === activeTab)) return null;

    // If somehow a non-authorized user navigates to an HQ tab, block and show secure card
"""
if old_render not in text:
    raise SystemExit('QA render boundary target not found')
text = text.replace(old_render, new_render, 1)
path.write_text(text)
print('Final QA boundary hardening applied.')
