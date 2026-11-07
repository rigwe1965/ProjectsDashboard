// Tiny in-process metrics in the Prometheus text format. Counters only go up; gauges are read when scraped.
// Labels must have a small, fixed set of values (status class, result name): never put IPs, tokens or ids in them.
export function createMetrics() {
  const counters = new Map(); // name -> Map(labelString -> number)
  const gauges = new Map();   // name -> () => number
  const help = new Map();
  const labelKey = (labels) => Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}="${String(v).replace(/[\\"\n]/g, '_')}"`).join(',');
  return {
    describe: (name, text) => help.set(name, text),
    inc(name, labels = {}, by = 1) {
      const m = counters.get(name) ?? counters.set(name, new Map()).get(name);
      const k = labelKey(labels);
      m.set(k, (m.get(k) ?? 0) + by);
    },
    gauge: (name, fn) => gauges.set(name, fn),
    get(name, labels = {}) { return counters.get(name)?.get(labelKey(labels)) ?? 0; },
    render() {
      const out = [];
      for (const [name, series] of counters) {
        if (help.has(name)) out.push(`# HELP ${name} ${help.get(name)}`);
        out.push(`# TYPE ${name} counter`);
        for (const [k, v] of series) out.push(`${name}${k ? `{${k}}` : ''} ${v}`);
      }
      for (const [name, fn] of gauges) {
        if (help.has(name)) out.push(`# HELP ${name} ${help.get(name)}`);
        out.push(`# TYPE ${name} gauge`, `${name} ${Number(fn()) || 0}`);
      }
      return out.join('\n') + '\n';
    },
  };
}
