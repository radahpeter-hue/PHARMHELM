from pathlib import Path

path = Path('scripts/apply-supervisor-capability-update.py')
text = path.read_text()
old = '''text = replace_exact(text, "  branch_id: string;\\n", "  branch_id: string;\\n  branch_name?: string;\\n  department?: string;\\n", 'Staff department')'''
new = '''text = replace_exact(text, "  role: UserRole;\\n  branch_id: string;\\n  assigned_branches: string[];\\n", "  role: UserRole;\\n  branch_id: string;\\n  branch_name?: string;\\n  department?: string;\\n  assigned_branches: string[];\\n", 'Staff department')'''
if old not in text:
    raise SystemExit('Expected ambiguous Staff replacement was not found')
path.write_text(text.replace(old, new, 1))
print('Supervisor transform repaired.')
