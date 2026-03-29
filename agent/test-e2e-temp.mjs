/**
 * Targeted E2E verification of the new memory system changes.
 * Tests dedup context quality improvement and threshold analysis.
 */
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const db = new Database(join(homedir(), '.openhelm', 'openhelm.db'), { readonly: true });

console.log('\n=== 1. Memory Dedup Readiness Check ===');
// Check how many memories in OpenHelm project would theoretically be near-duplicates
const projectId = db.prepare("SELECT id FROM projects WHERE name='OpenHelm'").get()?.id;
const withEmb = db.prepare(`SELECT COUNT(*) as c FROM memories WHERE project_id=? AND embedding IS NOT NULL AND is_archived=0`).get(projectId)?.c;
const total = db.prepare(`SELECT COUNT(*) as c FROM memories WHERE project_id=? AND is_archived=0`).get(projectId)?.c;
console.log(`  OpenHelm: ${withEmb}/${total} memories have embeddings (consolidation requires embeddings)`);
console.log(`  ACTION NEEDED: Run 'memories.consolidate' after new runs generate embeddings`);

console.log('\n=== 2. Non-Cosine Retrieval Analysis ===');
// With new threshold 0.2, how many memories would get past non-cosine signals alone?
const now = Date.now();
const mems = db.prepare(`SELECT importance, type, updated_at, goal_id, job_id FROM memories WHERE project_id=? AND is_archived=0`).all(projectId || '');
let passOld=0, passNew=0;
for (const m of mems) {
  const ageDays = (now - new Date(m.updated_at).getTime()) / (1000*60*60*24);
  const recency = Math.pow(0.5, ageDays/21);
  const typeW = {procedural:1.0, semantic:0.8, episodic:0.6, source:0.5}[m.type] ?? 0.5;
  const scope = m.job_id ? 1.0 : m.goal_id ? 0.67 : 0.33;
  const baseScore = 0.15*scope + 0.15*(m.importance/10) + 0.15*typeW + 0.15*recency;
  if (baseScore >= 0.3) passOld++;
  if (baseScore >= 0.2) passNew++;
}
const pct = n => Math.round(n/mems.length*100);
console.log(`  With zero cosine (no embeddings), project-scope only:`);
console.log(`  OLD threshold 0.3: ${passOld}/${mems.length} (${pct(passOld)}%) would be retrieved`);
console.log(`  NEW threshold 0.2: ${passNew}/${mems.length} (${pct(passNew)}%) would be retrieved`);
console.log(`  → ${passNew-passOld} additional memories unlocked by threshold change`);

console.log('\n=== 3. Schema Change Verification ===');
// Verify the schema has been deployed correctly
// (we can't check the compiled code directly, but we can verify our source)
const { existsSync, readFileSync } = await import('fs');
const schemaPath = './agent/src/planner/schemas.ts';
const extractorPath = './agent/src/memory/extractor.ts';
if (existsSync(schemaPath)) {
  const schema = readFileSync(schemaPath, 'utf8');
  const hasIgnore = schema.includes('"ignore"');
  console.log(`  schemas.ts has "ignore" action: ${hasIgnore ? '✓' : '✗'}`);
}
if (existsSync(extractorPath)) {
  const extractor = readFileSync(extractorPath, 'utf8');
  const hasIgnoreAction = extractor.includes('ext.action === "ignore"');
  const hasDeupBlock = extractor.includes('CRITICAL');
  const hasNearDupe = extractor.includes('NEAR_DUPE_THRESHOLD');
  const hasFallthroughFix = extractor.includes('not creating duplicate');
  const hasSemanticContext = extractor.includes('semantically-relevant');
  console.log(`  extractor.ts ignore action handler: ${hasIgnoreAction ? '✓' : '✗'}`);
  console.log(`  extractor.ts dedup prompt block: ${hasDeupBlock ? '✓' : '✗'}`);
  console.log(`  extractor.ts near-dupe detection: ${hasNearDupe ? '✓' : '✗'}`);
  console.log(`  extractor.ts fallthrough fix: ${hasFallthroughFix ? '✓' : '✗'}`);
  console.log(`  extractor.ts semantic dedup context: ${hasSemanticContext ? '✓' : '✗'}`);
}

console.log('\n=== 4. Retriever + Executor Changes ===');
const retrieverPath = './agent/src/memory/retriever.ts';
const executorPath = './agent/src/executor/index.ts';
if (existsSync(retrieverPath)) {
  const r = readFileSync(retrieverPath, 'utf8');
  const newThreshold = r.includes('SCORE_THRESHOLD = 0.2');
  console.log(`  retriever.ts threshold lowered to 0.2: ${newThreshold ? '✓' : '✗'}`);
}
if (existsSync(executorPath)) {
  const e = readFileSync(executorPath, 'utf8');
  const betterQuery = e.includes('richer retrieval query');
  const autoPrune = e.includes('Auto-prune memories every 10th');
  console.log(`  executor.ts richer retrieval query: ${betterQuery ? '✓' : '✗'}`);
  console.log(`  executor.ts auto-prune trigger: ${autoPrune ? '✓' : '✗'}`);
}

console.log('\n=== 5. Production Embedding Gap ===');
console.log(`  Root cause of zero access_count:`);
console.log(`  - /Applications/OpenHelm.app does NOT bundle @xenova/transformers`);
console.log(`  - Production agent: generateEmbedding() fails silently → no embeddings stored`);
console.log(`  - Production agent: query embedding fails → retrieveMemories() returns []`);
console.log(`  - Result: memories created but never injected into runs`);
console.log(`  Fix (future): bundle @xenova/transformers + onnxruntime-node in production app`);
console.log(`  Our fixes: dedup extraction (all env) + lower threshold (helps dev env immediately)`);

db.close();
