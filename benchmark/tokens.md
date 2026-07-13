# Stage 1 — static token counts (o200k_base)

| app | T | I | R | React/TSX | React ÷ I |
|---|---|---|---|---|---|
| counter | 36 | 36 | 43 | 70 | 1.9× |
| todos | 178 | 188 | 225 | 385 | 2.0× |
| tabs | 127 | 133 | 152 | 248 | 1.9× |
| form | 162 | 162 | 193 | 278 | 1.7× |
| stopwatch | 119 | 119 | 146 | 241 | 2.0× |
| **total** | **622** | **638** | **759** | **1222** | **1.9×** |

In-context spec sizes: T=1245, I=1235, R=1360 tokens.

Stage-1 gate (plan): AIL must beat React source tokens by ≥2× on the examples.
