import { useEffect, useRef, useState } from "react";

export default function Stopwatch() {
  const [ms, setMs] = useState(0);
  const [run, setRun] = useState(false);

  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => setMs((m) => m + 100), 100);
    return () => clearInterval(id);
  }, [run]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 24 }}>
      <div style={{ fontWeight: 700, fontSize: 24 }}>
        {Math.trunc(ms / 1000)}.{Math.trunc((ms % 1000) / 100)}s
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setRun(!run)}>{run ? "Stop" : "Start"}</button>
        <button onClick={() => setMs(0)}>Reset</button>
      </div>
    </div>
  );
}
