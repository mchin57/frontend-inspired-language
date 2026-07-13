import { useState } from "react";

export default function Counter() {
  const [n, setN] = useState(0);
  return (
    <div style={{ padding: 24 }}>
      <button onClick={() => setN(n + 1)}>Count: {n}</button>
    </div>
  );
}
