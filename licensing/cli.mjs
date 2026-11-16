// The owner's licence tool (docs/PLAN-licensing.md). Run it on your own machine; the signing key never goes on a server.
//
//   node licensing/cli.mjs keygen [--out <file>]
//       makes your signing key (default: ~/.facyke-licence/signing-key.pem) and prints the PUBLIC key to build into the products.
//       Refuses to overwrite an existing key and refuses a place inside this repository.
//   node licensing/cli.mjs issue --product rmm --customer "Acme IT" --tier premium --limit devices=250 --limit users=25 \
//        --until 2027-11-30 [--from 2026-11-17] [--key <file>]
//       prints a licence (one line of text) to send the customer. Use --limit name=null for "unlimited".
//       Every licence issued is also noted in issued.jsonl next to the key (no secrets in it).
//   node licensing/cli.mjs inspect <licence text or file> [--public-key <key>] [--use devices=30] [--now <date>]
//       shows what a licence says and, with --public-key, whether it is genuine; with --use, what it allows at that usage.
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, peek, publicKeyOf, sign, verify } from './licence.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const defaultKeyFile = () => join(homedir(), '.facyke-licence', 'signing-key.pem');

/** Reads `--name value` pairs; a name given more than once (like --limit) collects all its values. */
function parse(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const name = argv[i].slice(2);
      const value = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      (flags[name] ??= []).push(value);
    } else rest.push(argv[i]);
  }
  return { flags, rest, one: (n) => flags[n]?.[0] };
}

const pairs = (list = [], what) =>
  Object.fromEntries(
    list.map((s) => {
      const m = /^([a-z]{2,20})=(null|\d+)$/.exec(s);
      if (!m) throw new Error(`${what} "${s}" must look like name=number (or name=null for unlimited)`);
      return [m[1], m[2] === 'null' ? null : Number(m[2])];
    }),
  );

const endOfDay = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? '') || Number.isNaN(Date.parse(d))) throw new Error('Dates must look like 2027-11-30');
  return `${d}T23:59:59Z`;
};

/** Runs one command. `io` = { out, err, now } so tests can drive it; returns the exit code. */
export function run(argv, io = { out: console.log, err: console.error, now: () => new Date() }) {
  const [cmd, ...more] = argv;
  const a = parse(more);
  try {
    if (cmd === 'keygen') {
      const file = resolve(a.one('out') ?? defaultKeyFile());
      if (file === REPO_ROOT || file.startsWith(REPO_ROOT + sep)) throw new Error('Keep the signing key outside this repository (a repository is copied around and pushed to GitHub). Choose another place with --out.');
      if (existsSync(file)) throw new Error(`There is already a key at ${file}. It is not replaced: licences already issued depend on it.`);
      mkdirSync(dirname(file), { recursive: true });
      const { privateKey } = generateKeyPairSync('ed25519');
      writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
      io.out(`Signing key saved to ${file}`);
      io.out('Back it up somewhere safe and private (not a repository). If it is lost, no new licence can be issued that existing products accept.');
      io.out(`Public key (build this into each product): ${publicKeyOf(privateKey)}`);
      return 0;
    }
    if (cmd === 'issue') {
      const keyFile = resolve(a.one('key') ?? defaultKeyFile());
      if (!existsSync(keyFile)) throw new Error(`No signing key at ${keyFile}. Make one first: node licensing/cli.mjs keygen`);
      const now = io.now();
      const payload = {
        v: 1,
        id: `lic_${randomBytes(6).toString('hex')}`,
        product: a.one('product'),
        customer: a.one('customer'),
        tier: a.one('tier'),
        limits: pairs(a.flags.limit, '--limit'),
        iat: a.one('from') ? `${a.one('from')}T00:00:00Z` : now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        exp: endOfDay(a.one('until')),
      };
      const token = sign(payload, readFileSync(keyFile, 'utf8'));
      appendFileSync(join(dirname(keyFile), 'issued.jsonl'), `${JSON.stringify(payload)}\n`);
      io.out(token);
      io.err(`Issued ${payload.id}: ${payload.product} for ${payload.customer}, ${payload.tier}, until ${payload.exp.slice(0, 10)}.`);
      return 0;
    }
    if (cmd === 'inspect') {
      const arg = a.rest[0];
      if (!arg) throw new Error('Give a licence text or the file it is in.');
      const text = existsSync(arg) ? readFileSync(arg, 'utf8').trim() : arg;
      const licence = peek(text);
      if (!licence) throw new Error('That is not a licence (it should start with FKL1.).');
      io.out(JSON.stringify(licence, null, 2));
      const pub = a.one('public-key');
      if (pub) {
        const v = verify(text, { publicKeys: [pub] });
        io.out(v.ok ? 'Signature: genuine' : `Signature: NOT genuine (${v.reason})`);
        if (!v.ok) return 2;
      } else io.out('Signature: not checked (give --public-key to check it)');
      const usage = pairs(a.flags.use, '--use');
      const now = a.one('now') ? new Date(a.one('now')) : io.now();
      const e = evaluate(licence, now, usage);
      io.out(`At ${now.toISOString().slice(0, 10)}: ${e.state}, ${e.daysLeft} day(s) to the end date${Object.keys(usage).length ? `, may add: ${JSON.stringify(e.canAdd)}` : ''}`);
      if (e.banner) io.out(`Banner: ${e.banner}`);
      return 0;
    }
    io.err('Usage: keygen | issue | inspect (see the top of licensing/cli.mjs)');
    return 1;
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
