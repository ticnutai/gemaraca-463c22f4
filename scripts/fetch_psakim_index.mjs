// Fetch all psakim for all leaf nodes from the sources index
// Supports --retry mode: loads existing data and only fetches missing tags
import { readFileSync, writeFileSync, existsSync } from 'fs';

const PSAKIM_BASE = 'https://www.psakim.org';
const isRetry = process.argv.includes('--retry');

// Load the sources index tree
const tree = JSON.parse(readFileSync('public/psakim_sources_index.json', 'utf-8'));

// Collect all leaf node IDs
const leaves = [];
function collectLeaves(node, path) {
  if (!node.children || node.children.length === 0) {
    leaves.push({ id: node.id, text: node.text, path });
  } else {
    for (const c of node.children) {
      collectLeaves(c, path + ' > ' + c.text);
    }
  }
}
for (const branch of tree.children) {
  collectLeaves(branch, branch.text);
}
console.log(`Found ${leaves.length} leaf nodes`);

// Load existing data if retry mode
let tagPsakim = {};
let psakimIndex = {};
if (isRetry && existsSync('public/tag_psakim_map.json')) {
  tagPsakim = JSON.parse(readFileSync('public/tag_psakim_map.json', 'utf-8'));
  psakimIndex = JSON.parse(readFileSync('public/psakim_index.json', 'utf-8'));
  console.log(`Loaded existing: ${Object.keys(tagPsakim).length} tags, ${Object.keys(psakimIndex).length} psakim`);
}

// Filter to only missing leaves
const toFetch = isRetry ? leaves.filter(l => !(l.id in tagPsakim)) : leaves;
console.log(`To fetch: ${toFetch.length} leaves`);

let done = 0;
let errors = 0;

async function fetchTag(leaf) {
  try {
    const res = await fetch(`${PSAKIM_BASE}/PsakimData/Tag?id=${leaf.id}&ipage=0`);
    const data = await res.json();
    const files = data.files || [];
    tagPsakim[leaf.id] = files.length > 0
      ? files.map(f => [f.file.id, f.tag?.tag?.ogenID || ''])
      : [];
    for (const f of files) {
      if (!psakimIndex[f.file.id]) {
        const quat = (f.file.quat || '').replace(/<[^>]*>/g, '').substring(0, 200);
        psakimIndex[f.file.id] = { n: f.file.name, b: f.file.betdin, q: quat };
      }
    }
  } catch (e) {
    errors++;
  }
  done++;
  if (done % 50 === 0) {
    console.log(`Progress: ${done}/${toFetch.length}, errors: ${errors}, psakim: ${Object.keys(psakimIndex).length}`);
  }
}

const BATCH_SIZE = isRetry ? 5 : 5;   // קצב עדין לאתר המקור
const DELAY = isRetry ? 400 : 400;
for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
  const batch = toFetch.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(fetchTag));
  await new Promise(r => setTimeout(r, DELAY));
}

console.log(`\nDone! ${done}/${toFetch.length}, errors: ${errors}`);
console.log(`Total unique psakim: ${Object.keys(psakimIndex).length}`);
console.log(`Total tags with data: ${Object.keys(tagPsakim).length}`);

// Save
writeFileSync('public/tag_psakim_map.json', JSON.stringify(tagPsakim));
writeFileSync('public/psakim_index.json', JSON.stringify(psakimIndex));

console.log('Files saved to public/');
