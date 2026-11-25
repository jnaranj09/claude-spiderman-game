// Puts what an editor saved into the game's own tables.
//
//   node tools/apply-editor-save.mjs moves|suit|body <save.json> [--write]
//
// <save.json> is the editor's saved document ({ moves | style | body, savedAt }), as fetched from its artifact's
// database (moves/current, suit/current, body/current). Without --write it only lists what would change. Only the
// numbers are rewritten: the tables' comments and layout stay as they are.
//   moves -> HERO_MOVES in js/spiderman.js (pose-editor.html)
//   suit  -> SUIT_STYLE in js/pedestrians.js (suit-editor.html)
//   body  -> HERO_BODY in js/pedestrians.js (body-editor.html)
import fs from 'node:fs';

const [kind, file, ...flags] = process.argv.slice(2);
const write = flags.includes('--write');
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const doc = raw.data || raw;
const r4 = (v) => Math.round(v * 10000) / 10000;
const same = (a, b) => Math.abs(a - b) < 5e-5;
let n = 0;

// The text of `const NAME = { ... };` in a source file, and the object it makes
function tableOf(path, name, endMark = '\n};\n') {
  const src = fs.readFileSync(path, 'utf8');
  const start = src.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`no ${name} in ${path}`);
  const end = src.indexOf(endMark, start) + endMark.length;
  const text = src.slice(start, end);
  return { path, src, start, end, text, value: new Function(`${text}; return ${name};`)() };
}
function put(table, text) {
  if (write) fs.writeFileSync(table.path, table.src.slice(0, table.start) + text + table.src.slice(table.end));
}
// Rewrites the number after `key: ` (the first one from `from` on)
function setNumber(text, key, value, from = 0) {
  const re = new RegExp(`(\\b${key}: )-?(?:0x[0-9a-fA-F]+|[0-9.]+(?:e-?[0-9]+)?)`);
  const head = text.slice(0, from), tail = text.slice(from);
  if (!re.test(tail)) throw new Error(`no ${key}`);
  return head + tail.replace(re, `$1${value}`);
}

if (kind === 'moves') {
  const saved = doc.moves;
  const src = fs.readFileSync('js/spiderman.js', 'utf8');
  const start = src.indexOf('const HERO_MOVES = {'), end = src.indexOf('const HERO_MOVES_DEFAULT');
  let table = src.slice(start, end);
  const game = new Function(`${table}; return HERO_MOVES;`)();
  const fmt = (a) => `[${a.map(r4).join(', ')}]`;
  for (const name in saved.poses) {
    const pose = game.poses[name];
    if (!pose) { console.log('unknown pose', name); continue; }
    const at = table.indexOf(`    ${name}: {`);
    const stop = Math.min(...[' },\n', ' }\n'].map((e) => table.indexOf(e, at)).filter((i) => i >= 0));
    let block = table.slice(at, stop);
    for (const joint in saved.poses[name]) {
      const a = saved.poses[name][joint], b = pose[joint];
      if (!b) { console.log('unknown joint', name, joint); continue; }
      if (a.every((v, i) => same(v, b[i]))) continue;
      console.log(`${name}.${joint}: ${fmt(b)} -> ${fmt(a)}   (deg ${a.map((v) => Math.round(v * 57.3)).join(', ')})`);
      const re = new RegExp(`(\\b${joint}: )\\[[^\\]]*\\]`);
      // (a lean from the hips is written into a pose only once it has one)
      if (re.test(block)) block = block.replace(re, `$1${fmt(a)}`);
      else if (joint === 'lean') block += `, lean: ${fmt(a)}`;
      else throw new Error(`no ${joint} in ${name}`);
      n++;
    }
    table = table.slice(0, at) + block + table.slice(stop);
  }
  for (const group of ['gait', 'tilt', 'swing', 'zip', 'feel']) {
    for (const key in saved[group] || {}) {
      const a = saved[group][key], b = game[group][key];
      if (b === undefined) { console.log('unknown', group, key); continue; }
      if (same(a, b)) continue;
      console.log(`${group}.${key}: ${r4(b)} -> ${r4(a)}`);
      table = setNumber(table, key, r4(a), table.indexOf(`\n  ${group}: {`));
      n++;
    }
  }
  if (write) fs.writeFileSync('js/spiderman.js', src.slice(0, start) + table + src.slice(end));
} else if (kind === 'suit') {
  const table = tableOf('js/pedestrians.js', 'SUIT_STYLE');
  let text = table.text;
  const colours = ['red', 'blue', 'ink', 'lens'];
  const hex = (v) => `0x${Math.round(v).toString(16).padStart(6, '0')}`;
  for (const key in doc.style) {
    const a = doc.style[key], b = table.value[key];
    if (b === undefined) { console.log('unknown', key); continue; }
    const colour = colours.includes(key);
    if (colour ? Math.round(a) === b : same(a, b)) continue;
    console.log(`${key}: ${colour ? hex(b) : r4(b)} -> ${colour ? hex(a) : r4(a)}`);
    text = setNumber(text, key, colour ? hex(a) : r4(a));
    n++;
  }
  put(table, text);
} else if (kind === 'body') {
  const table = tableOf('js/pedestrians.js', 'HERO_BODY');
  let text = table.text;
  const body = doc.body, game = table.value;
  // The rings of each part: [..] per ring, one to a line
  for (const part of ['head', 'torso', 'arm', 'leg']) {
    const a = body[part], b = game[part];
    if (!a) continue;
    if (a.length !== b.length) throw new Error(`${part}: ${a.length} rings saved, the game has ${b.length}`);
    let changed = 0;
    a.forEach((ring, i) => {
      if (ring.every((v, k) => same(v, b[i][k]))) return;
      console.log(`${part}[${i}]: [${b[i].map(r4).join(', ')}] -> [${ring.map(r4).join(', ')}]`);
      changed++;
    });
    if (!changed) continue;
    n += changed;
    const at = text.indexOf(`  ${part}: [\n`), stop = text.indexOf('\n  ],', at);
    text = `${text.slice(0, at)}  ${part}: [\n${a.map((ring) => `    [${ring.map(r4).join(', ')}]`).join(',\n')}${text.slice(stop)}`;
  }
  for (const key of ['armRoot', 'armpit', 'armpitReach', 'latReach', 'armRootFollow', 'armDepth']) {
    if (body[key] === undefined || same(body[key], game[key])) continue;
    console.log(`${key}: ${r4(game[key])} -> ${r4(body[key])}`);
    text = setNumber(text, key, r4(body[key]));
    n++;
  }
  if (body.foot && !body.foot.every((v, i) => same(v, game.foot[i]))) {
    console.log(`foot: [${game.foot.map(r4).join(', ')}] -> [${body.foot.map(r4).join(', ')}]`);
    text = text.replace(/(\bfoot: )\[[^\]]*\]/, `$1[${body.foot.map(r4).join(', ')}]`);
    n++;
  }
  // The corrective shapes per arm pose, as one line
  const tidy = (poses) => JSON.stringify(poses || {}, (k, v) => (typeof v === 'number' ? r4(v) : v));
  if (body.poses && tidy(body.poses) !== tidy(game.poses)) {
    console.log(`poses: ${tidy(game.poses)}\n    -> ${tidy(body.poses)}`);
    const spaced = tidy(body.poses).replace(/":/g, '": ').replace(/,/g, ', ');
    text = text.replace(/(\n  poses: )\{.*\},\n/, (m, head) => `${head}${spaced},\n`);
    n++;
  }
  put(table, text);
} else {
  throw new Error('moves, suit or body?');
}
console.log(n, 'changes', doc.savedAt || '', write ? '(written)' : '');
