from pathlib import Path

performance = Path('src/modules/hr/PerformanceDiscipline.tsx')
text = performance.read_text()
text = text.replace('                            <button \n                              onClick={() => {', '                            <button\n                              onClick={() => {', 1)
text = text.replace('                            <button \n                              onClick={() => handleDelete(inc.id)}', '                            <button\n                              onClick={() => handleDelete(inc.id)}', 1)
performance.write_text(text)

recruitment = Path('src/modules/hr/RecruitmentManager.tsx')
text = recruitment.read_text()
text = text.replace('        {!supervisorOnly && <button \n          onClick={() => setIsNewAppModalOpen(true)}', '        {!supervisorOnly && <button\n          onClick={() => setIsNewAppModalOpen(true)}', 1)
recruitment.write_text(text)

print('Generated patch whitespace normalized.')
