import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const db = new Database(join(homedir(), '.openhelm', 'openhelm.db'));

console.log('\n=== Memory Stats by Project ===');
const stats = db.prepare(`
  SELECT p.name, COUNT(m.id) as total,
    SUM(CASE WHEN m.access_count > 0 THEN 1 ELSE 0 END) as used,
    SUM(CASE WHEN m.access_count = 0 THEN 1 ELSE 0 END) as unused
  FROM projects p LEFT JOIN memories m ON p.id = m.project_id AND m.is_archived = 0
  GROUP BY p.id ORDER BY total DESC
`).all();
stats.forEach(r => console.log(`  ${r.name}: ${r.total} total, ${r.used} used, ${r.unused} unused`));

console.log('\n=== run_memories injection counts ===');
const injections = db.prepare(`SELECT run_id, COUNT(*) as c FROM run_memories GROUP BY run_id ORDER BY c DESC LIMIT 5`).all();
injections.length === 0 ? console.log('  None') : injections.forEach(r => console.log(`  Run ${r.run_id.slice(0,8)}...: ${r.c} injected`));

console.log('\n=== Embedding coverage ===');
const emb = db.prepare(`SELECT COUNT(*) as t, SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as e FROM memories WHERE is_archived=0`).get();
console.log(`  ${emb.e}/${emb.t} active memories have embeddings`);

console.log('\n=== Retrieval threshold analysis (project-level scope, varied importance) ===');
const projectId = db.prepare("SELECT id FROM projects WHERE name='OpenHelm'").get()?.id;
const mems = db.prepare(`SELECT importance, type, updated_at FROM memories WHERE project_id=? AND is_archived=0 LIMIT 50`).all(projectId || '');
const now = Date.now();
let o=0, n=0, total=mems.length;
for (const m of mems) {
  const ageDays = (now - new Date(m.updated_at).getTime()) / (1000*60*60*24);
  const recency = Math.pow(0.5, ageDays/21);
  const typeW = {procedural:1.0, semantic:0.8, episodic:0.6, source:0.5}[m.type] ?? 0.5;
  // project-level scope = 0.33, cosine = 0 (worst case)
  const score = 0.15*0.33 + 0.15*(m.importance/10) + 0.15*typeW + 0.15*recency;
  if (score >= 0.3) o++;
  if (score >= 0.2) n++;
}
console.log(`  Of ${total} sampled (worst-case zero cosine similarity, project scope):`);
console.log(`  OLD threshold 0.3: ${o}/${total} pass (${Math.round(o/total*100)}%)`);
console.log(`  NEW threshold 0.2: ${n}/${total} pass (${Math.round(n/total*100)}%)`);

db.close();
