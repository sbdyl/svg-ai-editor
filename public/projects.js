let opening;
function database() {
  if (!opening) opening = new Promise((resolve,reject) => {
    const request = indexedDB.open('figura-projects',1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}
async function transact(mode, action) {
  const db = await database();
  return new Promise((resolve,reject) => {
    const transaction = db.transaction('projects',mode), request = action(transaction.objectStore('projects'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('项目保存失败'));
  });
}
const journalKey = 'figura-pending-projects';
function journal() {
  const value = JSON.parse(localStorage.getItem(journalKey) || '{}');
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
// Stage edits synchronously so a refresh cannot overtake an IndexedDB transaction.
export function stageProject(project) {
  try { const pending = journal(); pending[project.id] = project; localStorage.setItem(journalKey,JSON.stringify(pending)); return true; }
  catch { return false; }
}
export async function writeProject(project) {
  await transact('readwrite',store => store.put(project));
  try {
    const pending = journal();
    if (pending[project.id]?.saveId === project.saveId) {
      delete pending[project.id];
      if (Object.keys(pending).length) localStorage.setItem(journalKey,JSON.stringify(pending));
      else localStorage.removeItem(journalKey);
    }
  } catch { /* A committed project remains available even if journal cleanup fails. */ }
}
export async function recoverPending() {
  for (const project of Object.values(journal())) {
    if (project?.id && typeof project.svg === 'string') await writeProject(project);
  }
}
export const readProject = id => transact('readonly',store => store.get(id));
export const listProjects = async () => (await transact('readonly',store => store.getAll())).sort((a,b) => b.updatedAt-a.updatedAt);
export async function migrateDraft() {
  const source = localStorage.getItem('figura-document');
  if (!source) return;
  let draft;
  try { draft = JSON.parse(source); } catch { return; }
  if (!draft?.svg) return;
  if (!await readProject('legacy-draft')) await writeProject({ ...draft, id: 'legacy-draft', updatedAt: Date.now() });
  localStorage.removeItem('figura-document');
}
