// AIL runtime: a fixed interpreter over the declaration table embedded in the page
// as JSON (global AIL_PROGRAM). All per-program behavior lives in data; this file is
// the only executable code, shared by every built program.
(function () {
  'use strict';
  const program = window.AIL_PROGRAM;
  const decls = program.decls;

  const sigs = new Map(); // id -> { v, subs: Set<fn> }
  const derives = new Map(); // id -> expr
  const comps = new Map(); // id -> decl
  const nodes = new Map(); // id -> decl
  const ons = new Map(); // nodeId -> [{event, action}]
  const acts = new Map(); // id -> { ms, action, handle }

  for (const d of decls) {
    if (d.kind === 'sig') sigs.set(d.id, { v: evalE(d.init, {}), subs: new Set() });
    else if (d.kind === 'derive') derives.set(d.id, d.expr);
    else if (d.kind === 'comp') comps.set(d.id, d);
    else if (d.kind === 'node') nodes.set(d.id, d);
    else if (d.kind === 'on') {
      if (!ons.has(d.node)) ons.set(d.node, []);
      ons.get(d.node).push(d);
    } else if (d.kind === 'act') acts.set(d.id, { ms: d.ms, action: d.action, handle: null });
  }

  // ------------------------------------------------------------ evaluation
  // scope: { it, ix, val, key, params: Map<name, {expr, scope}> }

  function evalE(e, scope) {
    switch (e.k) {
      case 'int': case 'float': return e.v;
      case 'str': return e.v;
      case 'bool': return e.v;
      case 'tpl': return e.parts.map((p) => (typeof p === 'string' ? p : show(evalE(p, scope)))).join('');
      case 'ref': {
        if (scope.params && scope.params.has(e.id)) {
          const p = scope.params.get(e.id);
          return evalE(p.expr, p.scope);
        }
        if (e.id === 'it') return scope.it;
        if (e.id === 'ix') return scope.ix;
        if (e.id === 'val') return scope.val;
        if (e.id === 'key') return scope.key;
        if (sigs.has(e.id)) return sigs.get(e.id).v;
        return evalE(derives.get(e.id), {});
      }
      case 'list': return e.items.map((x) => evalE(x, scope));
      case 'rec': {
        const o = {};
        for (const f of e.fields) o[f.name] = evalE(f.val, scope);
        return o;
      }
      case 'un': {
        const v = evalE(e.e, scope);
        return e.op === '!' ? !v : -v;
      }
      case 'bin': {
        const l = evalE(e.l, scope);
        if (e.op === '&&') return l && evalE(e.r, scope);
        if (e.op === '||') return l || evalE(e.r, scope);
        const r = evalE(e.r, scope);
        switch (e.op) {
          case '+': return l + r;
          case '-': return l - r;
          case '*': return l * r;
          case '/': return e.fdiv ? l / r : Math.trunc(l / r);
          case '%': return l % r;
          case '<': return l < r;
          case '<=': return l <= r;
          case '>': return l > r;
          case '>=': return l >= r;
          case '==': return eq(l, r);
          case '!=': return !eq(l, r);
        }
        break;
      }
      case 'tern': return evalE(e.c, scope) ? evalE(e.t, scope) : evalE(e.e, scope);
      case 'field': return evalE(e.e, scope)[e.f];
      case 'index': return evalE(e.e, scope)[evalE(e.i, scope)];
      case 'call': {
        const a0 = evalE(e.args[0], scope);
        switch (e.fn) {
          case 'len': return a0.length;
          case 'filter': {
            const pred = e.args[1];
            return a0.filter((x) => (pred.neg ? !x[pred.f] : !!x[pred.f]));
          }
          case 'has': return a0.includes(evalE(e.args[1], scope));
          case 'int': { const n = parseInt(a0, 10); return Number.isNaN(n) ? 0 : n; }
          case 'str': return show(a0);
        }
        break;
      }
    }
    throw new Error('bad expr ' + e.k);
  }

  function eq(a, b) {
    if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
    if (a && typeof a === 'object') {
      const ka = Object.keys(a);
      return ka.length === Object.keys(b).length && ka.every((k) => eq(a[k], b[k]));
    }
    return a === b;
  }

  function show(v) {
    if (v === true) return 'true';
    if (v === false) return 'false';
    return String(v);
  }

  // ------------------------------------------------------------ dependencies

  function deps(e, scope, out) {
    out = out || new Set();
    if (!e || typeof e !== 'object') return out;
    if (e.k === 'ref') {
      if (scope.params && scope.params.has(e.id)) {
        const p = scope.params.get(e.id);
        deps(p.expr, p.scope, out);
      } else if (sigs.has(e.id)) out.add(e.id);
      else if (derives.has(e.id)) deps(derives.get(e.id), {}, out);
      return out;
    }
    if (e.k === 'tpl') { e.parts.forEach((p) => { if (typeof p !== 'string') deps(p, scope, out); }); return out; }
    for (const key of ['e', 'l', 'r', 'c', 't', 'i', 'init']) if (e[key]) deps(e[key], scope, out);
    if (e.items) e.items.forEach((x) => deps(x, scope, out));
    if (e.fields) e.fields.forEach((f) => deps(f.val, scope, out));
    if (e.args) e.args.forEach((x) => deps(x, scope, out));
    return out;
  }

  // subscription collectors so each-block re-renders can dispose stale watchers
  const collectors = [];
  function subscribe(depSet, fn) {
    for (const id of depSet) {
      sigs.get(id).subs.add(fn);
      if (collectors.length) collectors[collectors.length - 1].push({ id, fn });
    }
  }
  function watch(expr, scope, fn) {
    const d = deps(expr, scope);
    if (d.size) subscribe(d, fn);
    fn();
  }

  // ------------------------------------------------------------ actions

  let changed = null; // non-null while an action batch is running

  function runTopAction(action, scope) {
    const mine = changed === null;
    if (mine) changed = new Set();
    try {
      runAction(action, scope);
    } finally {
      if (mine) {
        const fns = new Set();
        for (const id of changed) sigs.get(id).subs.forEach((f) => fns.add(f));
        changed = null;
        fns.forEach((f) => f());
      }
    }
  }

  function runAction(a, scope) {
    switch (a.k) {
      case 'assign': {
        const cell = sigs.get(a.sig);
        const rhs = evalE(a.e, scope);
        if (a.steps.length === 0) {
          if (a.op === '=') cell.v = rhs;
          else if (a.op === '+=') cell.v = Array.isArray(cell.v) ? cell.v.concat([rhs]) : cell.v + rhs;
          else cell.v = Array.isArray(cell.v) ? cell.v.filter((_, i) => i !== rhs) : cell.v - rhs;
        } else {
          cell.v = updatePath(cell.v, a.steps, 0, scope, rhs, a.op);
        }
        changed.add(a.sig);
        return;
      }
      case 'seq': a.items.forEach((x) => runAction(x, scope)); return;
      case 'guard':
        if (evalE(a.c, scope)) runAction(a.t, scope);
        else if (a.e) runAction(a.e, scope);
        return;
      case 'timer': {
        const act = acts.get(a.act);
        if (a.which === 'start') {
          if (act.handle === null) act.handle = setInterval(() => runTopAction(act.action, {}), act.ms);
        } else if (act.handle !== null) {
          clearInterval(act.handle);
          act.handle = null;
        }
        return;
      }
    }
  }

  function updatePath(cur, steps, i, scope, rhs, op) {
    const s = steps[i];
    const last = i === steps.length - 1;
    if (s.k === 'index') {
      const idx = evalE(s.i, scope);
      const copy = cur.slice();
      copy[idx] = last ? applyOp(copy[idx], rhs, op) : updatePath(copy[idx], steps, i + 1, scope, rhs, op);
      return copy;
    }
    const copy = Object.assign({}, cur);
    copy[s.f] = last ? applyOp(copy[s.f], rhs, op) : updatePath(copy[s.f], steps, i + 1, scope, rhs, op);
    return copy;
  }

  function applyOp(old, rhs, op) {
    if (op === '=') return rhs;
    if (op === '+=') return Array.isArray(old) ? old.concat([rhs]) : old + rhs;
    return Array.isArray(old) ? old.filter((_, i) => i !== rhs) : old - rhs;
  }

  // ------------------------------------------------------------ rendering

  const BOOL_PROPS = { checked: 1, disabled: 1 };

  function render(spec, scope, isNamed, nodeId) {
    const el = document.createElement(spec.tag);
    for (const a of spec.attrs) {
      if (a.name === 's') {
        for (const tok of a.val.v.split(' ').filter(Boolean)) el.classList.add('s_' + tok);
        continue;
      }
      watch(a.val, scope, () => {
        const v = evalE(a.val, scope);
        if (a.name === 'show') el.style.display = v ? '' : 'none';
        else if (a.name === 'value') { if (el.value !== v) el.value = v; }
        else if (BOOL_PROPS[a.name]) el[a.name] = v;
        else el.setAttribute(a.name, show(v));
      });
    }
    for (const c of spec.children) renderChild(el, c, scope);
    if (isNamed && ons.has(nodeId)) {
      for (const h of ons.get(nodeId)) {
        el.addEventListener(h.event, (ev) => {
          if (h.event === 'submit') ev.preventDefault();
          runTopAction(h.action, {
            it: scope.it, ix: scope.ix, params: scope.params,
            val: ev.target && 'value' in ev.target ? ev.target.value : undefined,
            key: ev.key,
          });
        });
      }
    }
    return el;
  }

  function renderChild(parent, c, scope) {
    if (c.k === 'noderef') {
      const spec = nodes.get(c.id);
      parent.appendChild(render(spec, scope, true, c.id));
    } else if (c.k === 'text') {
      const t = document.createTextNode('');
      watch(c.tpl, scope, () => { t.textContent = evalE(c.tpl, scope); });
      parent.appendChild(t);
    } else if (c.k === 'inline') {
      parent.appendChild(render(c.node, scope, false));
    } else if (c.k === 'inst') {
      const comp = comps.get(c.comp);
      const params = new Map();
      for (const a of c.args) params.set(a.name, { expr: a.val, scope });
      parent.appendChild(render(comp.body, { params }, false));
    } else if (c.k === 'each') {
      const start = document.createComment('each');
      const end = document.createComment('/each');
      parent.appendChild(start);
      parent.appendChild(end);
      const spec = nodes.get(c.tpl);
      let disposer = [];
      const rerender = () => {
        for (const { id, fn } of disposer) sigs.get(id).subs.delete(fn);
        disposer = [];
        while (start.nextSibling !== end) start.nextSibling.remove();
        const items = evalE(c.list, scope);
        collectors.push(disposer);
        try {
          items.forEach((item, i) => {
            const s = { it: item, ix: i, params: scope.params, val: scope.val, key: scope.key };
            end.parentNode.insertBefore(render(spec, s, true, c.tpl), end);
          });
        } finally {
          collectors.pop();
        }
      };
      const d = deps(c.list, scope);
      if (d.size) subscribe(d, rerender);
      rerender();
    }
  }

  document.body.appendChild(render(nodes.get('root'), {}, true, 'root'));
})();
