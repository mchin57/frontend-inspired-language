import { useState } from "react";

const PANELS = [
  { label: "Home", text: "Home page" },
  { label: "About", text: "All about us" },
  { label: "Help", text: "Get help here" },
];

export default function Tabs() {
  const [tab, setTab] = useState(0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 24 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {PANELS.map((p, i) => (
          <button key={i} onClick={() => setTab(i)}>
            {p.label}
          </button>
        ))}
      </div>
      {PANELS.map((p, i) => (
        <div
          key={i}
          style={{
            display: tab === i ? "block" : "none",
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 16,
          }}
        >
          {p.text}
        </div>
      ))}
    </div>
  );
}
