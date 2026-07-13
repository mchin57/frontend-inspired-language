import { useState } from "react";

export default function Form() {
  const [email, setEmail] = useState("");
  const [age, setAge] = useState("");
  const [sent, setSent] = useState(false);
  const emailOk = email.includes("@");
  const ageOk = parseInt(age, 10) >= 18;
  const ok = emailOk && ageOk;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 24 }}>
      <input
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {!emailOk && (
        <div style={{ color: "#767676", fontSize: 12 }}>Invalid email</div>
      )}
      <input
        placeholder="Age"
        value={age}
        onChange={(e) => setAge(e.target.value)}
      />
      {!ageOk && (
        <div style={{ color: "#767676", fontSize: 12 }}>Must be 18+</div>
      )}
      <button disabled={!ok} onClick={() => ok && setSent(true)}>
        Send
      </button>
      {sent && <div>Sent!</div>}
    </div>
  );
}
