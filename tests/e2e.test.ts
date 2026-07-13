// End-to-end: build each example to HTML, run it in jsdom, drive real DOM events,
// and assert on rendered state. This is the runtime's behavioral test suite.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { build } from '../src/build.js';

const EX = join(__dirname, '..', 'examples');

function load(name: string): JSDOM {
  const text = readFileSync(join(EX, name), 'utf8').replace(/\r\n/g, '\n');
  return new JSDOM(build(text), { runScripts: 'dangerously', pretendToBeVisual: true });
}

function q<T extends Element = HTMLElement>(dom: JSDOM, id: string): T {
  const el = dom.window.document.querySelector(`[data-ail=${id}]`);
  expect(el, `node '${id}' should be in the DOM`).toBeTruthy();
  return el as T;
}
function qa(dom: JSDOM, id: string): Element[] {
  return [...dom.window.document.querySelectorAll(`[data-ail=${id}]`)];
}
function fire(dom: JSDOM, el: Element, type: string, init?: KeyboardEventInit): void {
  const Ev = type === 'keydown' ? dom.window.KeyboardEvent : dom.window.Event;
  el.dispatchEvent(new Ev(type, { bubbles: true, ...init }));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('counter', () => {
  it('increments on click', () => {
    const dom = load('counter.i.ail');
    const btn = q(dom, 'btn');
    expect(btn.textContent).toBe('Count: 0');
    fire(dom, btn, 'click');
    fire(dom, btn, 'click');
    expect(btn.textContent).toBe('Count: 2');
  });

  it('profiles T and R build identical behavior', () => {
    for (const f of ['counter.t.ail', 'counter.r.ail']) {
      const dom = load(f);
      const btn = q(dom, 'btn');
      fire(dom, btn, 'click');
      expect(btn.textContent).toBe('Count: 1');
    }
  });
});

describe('todos', () => {
  it('adds, toggles, and deletes items', () => {
    const dom = load('todos.i.ail');
    const inp = q<HTMLInputElement>(dom, 'inp');
    const add = q(dom, 'add');

    inp.value = 'buy milk';
    fire(dom, inp, 'input');
    fire(dom, add, 'click');
    inp.value = 'walk dog';
    fire(dom, inp, 'input');
    fire(dom, add, 'click');

    expect(qa(dom, 'row').length).toBe(2);
    expect(qa(dom, 'row')[0]!.textContent).toContain('buy milk');
    expect(dom.window.document.body.textContent).toContain('2 left');
    expect(inp.value).toBe(''); // draft cleared after add

    // empty draft is guarded
    fire(dom, add, 'click');
    expect(qa(dom, 'row').length).toBe(2);

    // toggle first item done -> "1 left"
    fire(dom, qa(dom, 'tgl')[0]!, 'change');
    expect(dom.window.document.body.textContent).toContain('1 left');
    expect((qa(dom, 'tgl')[0] as HTMLInputElement).checked).toBe(true);

    // delete first item
    fire(dom, qa(dom, 'del')[0]!, 'click');
    expect(qa(dom, 'row').length).toBe(1);
    expect(qa(dom, 'row')[0]!.textContent).toContain('walk dog');
    expect(dom.window.document.body.textContent).toContain('1 left');
  });
});

describe('tabs', () => {
  it('switches visible panel via component instances', () => {
    const dom = load('tabs.i.ail');
    const panels = [...dom.window.document.querySelectorAll('.s_card')] as HTMLElement[];
    expect(panels.length).toBe(3);
    expect(panels.map((p) => p.style.display)).toEqual(['', 'none', 'none']);
    fire(dom, q(dom, 't2'), 'click');
    expect(panels.map((p) => p.style.display)).toEqual(['none', 'none', '']);
    expect(panels[2]!.textContent).toBe('Get help here');
  });
});

describe('form', () => {
  it('derived validation gates the submit button', () => {
    const dom = load('form.i.ail');
    const email = q<HTMLInputElement>(dom, 'emailin');
    const age = q<HTMLInputElement>(dom, 'agein');
    const send = q<HTMLButtonElement>(dom, 'send');

    const sentDiv = [...dom.window.document.querySelectorAll('div')]
      .find((d) => d.textContent === 'Sent!') as HTMLElement;
    expect(send.disabled).toBe(true);
    fire(dom, send, 'click'); // guarded: no effect
    expect(sentDiv.style.display).toBe('none');

    email.value = 'a@b.c';
    fire(dom, email, 'input');
    age.value = '44';
    fire(dom, age, 'input');
    expect(send.disabled).toBe(false);

    fire(dom, send, 'click');
    expect(sentDiv.style.display).toBe('');
  });

  it('shows validation hints only when invalid', () => {
    const dom = load('form.i.ail');
    const hint = [...dom.window.document.querySelectorAll('div')]
      .find((d) => d.textContent === 'Invalid email') as HTMLElement;
    expect(hint.style.display).toBe('');
    const email = q<HTMLInputElement>(dom, 'emailin');
    email.value = 'a@b.c';
    fire(dom, email, 'input');
    expect(hint.style.display).toBe('none');
  });
});

describe('stopwatch', () => {
  it('start/stop/reset via act timer', async () => {
    const dom = load('stopwatch.i.ail');
    const go = q(dom, 'go');
    const disp = q(dom, 'disp');
    expect(go.textContent).toBe('Start');
    expect(disp.textContent).toBe('0.0s');

    fire(dom, go, 'click'); // start
    expect(go.textContent).toBe('Stop');
    await sleep(350);
    fire(dom, go, 'click'); // stop
    const after = disp.textContent!;
    expect(after).not.toBe('0.0s');
    await sleep(200); // stopped: display must not advance
    expect(disp.textContent).toBe(after);

    fire(dom, q(dom, 'rst'), 'click');
    expect(disp.textContent).toBe('0.0s');
  });
});
