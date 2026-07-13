import { useState } from "react";

type Todo = { text: string; done: boolean };

export default function Todos() {
  const [draft, setDraft] = useState("");
  const [todos, setTodos] = useState<Todo[]>([]);
  const left = todos.filter((t) => !t.done).length;

  const add = () => {
    if (draft !== "") {
      setTodos([...todos, { text: draft, done: false }]);
      setDraft("");
    }
  };
  const toggle = (i: number) =>
    setTodos(todos.map((t, j) => (j === i ? { ...t, done: !t.done } : t)));
  const remove = (i: number) => setTodos(todos.filter((_, j) => j !== i));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 24 }}>
      <h1>Todos</h1>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          placeholder="Add todo"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button onClick={add}>Add</button>
      </div>
      <ul style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {todos.map((t, i) => (
          <li key={i} style={{ display: "flex", gap: 8 }}>
            <input type="checkbox" checked={t.done} onChange={() => toggle(i)} />
            {t.text}
            <button onClick={() => remove(i)}>x</button>
          </li>
        ))}
      </ul>
      {left} left
    </div>
  );
}
