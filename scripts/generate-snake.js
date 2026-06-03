const fs = require("fs/promises");

const username = process.env.USERNAME || "nariokeith";
const token = process.env.GITHUB_TOKEN;
const output = process.env.OUTPUT || "dist/snake.svg";
const animationDuration = "18s";

const query = `
query($userName: String!) {
  user(login: $userName) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            weekday
          }
        }
      }
    }
  }
}`;

async function fetchGraphqlCalendar() {
  if (!token) return null;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { userName: username } }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed: ${response.status}`);
  }

  const json = await response.json();
  if (json.errors) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  return json.data.user.contributionsCollection.contributionCalendar;
}

async function fetchPublicCalendar() {
  const response = await fetch(`https://github.com/users/${username}/contributions`);

  if (!response.ok) {
    throw new Error(`GitHub public contribution request failed: ${response.status}`);
  }

  const html = await response.text();
  const dayPattern =
    /<td\b(?=[^>]*data-ix="(\d+)")(?=[^>]*data-date="([^"]+)")(?=[^>]*data-level="(\d+)")[^>]*><\/td>\s*<tool-tip[^>]*>([\s\S]*?)<\/tool-tip>/g;
  const weeks = new Map();
  let totalContributions = 0;
  let match;

  while ((match = dayPattern.exec(html))) {
    const weekIndex = Number(match[1]);
    const date = match[2];
    const level = Number(match[3]);
    const tooltip = match[4].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const countMatch = tooltip.match(/(\d+)\s+contribution/);
    const contributionCount = countMatch ? Number(countMatch[1]) : 0;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();

    totalContributions += contributionCount;

    if (!weeks.has(weekIndex)) {
      weeks.set(weekIndex, { contributionDays: [] });
    }

    weeks.get(weekIndex).contributionDays.push({
      date,
      contributionCount,
      level,
      weekday,
    });
  }

  if (!weeks.size) {
    throw new Error("Could not parse public contribution calendar.");
  }

  return {
    totalContributions,
    weeks: [...weeks.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, week]) => ({
        contributionDays: week.contributionDays.sort((left, right) => left.weekday - right.weekday),
      })),
  };
}

function fallbackCalendar() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 52 * 7);

  const weeks = [];
  let totalContributions = 0;

  for (let week = 0; week < 53; week += 1) {
    const contributionDays = [];

    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      const contributionCount = 0;
      totalContributions += contributionCount;

      contributionDays.push({
        date: date.toISOString().slice(0, 10),
        contributionCount,
        level: 0,
        weekday: day,
      });
    }

    weeks.push({ contributionDays });
  }

  return { totalContributions, weeks };
}

async function fetchCalendar() {
  try {
    const graphqlCalendar = await fetchGraphqlCalendar();
    if (graphqlCalendar) return normalizeCalendar(graphqlCalendar);
  } catch (error) {
    console.warn(error.message);
  }

  try {
    return normalizeCalendar(await fetchPublicCalendar());
  } catch (error) {
    console.warn(error.message);
  }

  return normalizeCalendar(fallbackCalendar());
}

function normalizeCalendar(calendar) {
  const weeks = calendar.weeks.map((week) => ({
    contributionDays: week.contributionDays
      .map((day) => ({
        date: day.date,
        contributionCount: Number(day.contributionCount) || 0,
        level: Number.isFinite(Number(day.level)) ? Number(day.level) : null,
        weekday: Number(day.weekday),
      }))
      .sort((left, right) => left.weekday - right.weekday),
  }));

  const days = weeks.flatMap((week) => week.contributionDays);
  const totalContributions =
    Number(calendar.totalContributions) || days.reduce((total, day) => total + day.contributionCount, 0);
  const maxContributions = Math.max(...days.map((day) => day.contributionCount), 1);

  days.forEach((day) => {
    if (day.level !== null) return;
    if (day.contributionCount === 0) {
      day.level = 0;
      return;
    }

    day.level = Math.max(1, Math.min(4, Math.ceil((day.contributionCount / maxContributions) * 4)));
  });

  return { totalContributions, weeks };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function monthLabels(weeks) {
  const labels = [];
  const seenMonths = new Set();

  weeks.forEach((week, weekIndex) => {
    const firstDay = week.contributionDays[0];
    if (!firstDay) return;

    const monthKey = firstDay.date.slice(0, 7);
    if (seenMonths.has(monthKey)) return;

    const date = new Date(`${firstDay.date}T00:00:00Z`);
    labels.push({
      label: date.toLocaleString("en", { month: "short", timeZone: "UTC" }),
      weekIndex,
    });
    seenMonths.add(monthKey);
  });

  if (labels.length > 1 && labels[1].weekIndex - labels[0].weekIndex < 4) {
    labels.shift();
  }

  return labels.filter(
    (label, index) => index === 0 || label.weekIndex - labels[index - 1].weekIndex >= 4
  );
}

function cellKey(col, row) {
  return `${col}:${row}`;
}

// ── Seeded PRNG (Mulberry32) — deterministic per day ────────────────────────
function mulberry32(seed) {
  let state = seed | 0;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateSeed() {
  const now = new Date();
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

// ── Randomized Hamiltonian walk ─────────────────────────────────────────────
// Produces a route that visits every cell in the grid using random directions
// (up, down, left, right). Uses greedy DFS with backtracking and prefers cells
// that have contributions (food) to make the animation more interesting.
function buildRoute(weeks) {
  const numCols = weeks.length;
  const numRows = 7;
  const rand = mulberry32(dateSeed());

  // Build a lookup from (col, row) → day data
  const dayAt = new Map();
  for (let col = 0; col < numCols; col += 1) {
    for (const day of weeks[col].contributionDays) {
      dayAt.set(cellKey(col, day.weekday), { col, row: day.weekday, day });
    }
  }

  const totalCells = dayAt.size;

  // Shuffle helper
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Neighbors in 4 cardinal directions
  const directions = [
    [0, -1], // up
    [0, 1],  // down
    [-1, 0], // left
    [1, 0],  // right
  ];

  function getNeighbors(col, row) {
    const neighbors = [];
    for (const [dc, dr] of directions) {
      const nc = col + dc;
      const nr = row + dr;
      const key = cellKey(nc, nr);
      if (dayAt.has(key)) {
        neighbors.push({ col: nc, row: nr, key });
      }
    }
    return neighbors;
  }

  // Try to build a Hamiltonian path using randomized DFS with Warnsdorff's heuristic
  // (prefer neighbors with fewer onward moves to avoid dead ends)
  function attemptHamiltonianWalk(startCol, startRow) {
    const visited = new Set();
    const route = [];
    const startKey = cellKey(startCol, startRow);
    const startCell = dayAt.get(startKey);
    if (!startCell) return [];

    visited.add(startKey);
    route.push(startCell);

    while (route.length < totalCells) {
      const current = route[route.length - 1];
      const neighbors = getNeighbors(current.col, current.row)
        .filter((n) => !visited.has(n.key));

      if (neighbors.length === 0) break;

      // Warnsdorff: pick neighbor with fewest onward unvisited neighbors
      // Tie-break: prefer cells with contributions (food), then random
      neighbors.sort((a, b) => {
        const aOnward = getNeighbors(a.col, a.row).filter((n) => !visited.has(n.key)).length;
        const bOnward = getNeighbors(b.col, b.row).filter((n) => !visited.has(n.key)).length;
        if (aOnward !== bOnward) return aOnward - bOnward;

        // Prefer food cells
        const aFood = dayAt.get(a.key).day.contributionCount > 0 ? 0 : 1;
        const bFood = dayAt.get(b.key).day.contributionCount > 0 ? 0 : 1;
        if (aFood !== bFood) return aFood - bFood;

        return rand() - 0.5;
      });

      const next = neighbors[0];
      visited.add(next.key);
      route.push(dayAt.get(next.key));
    }

    return route;
  }

  // Try multiple random starting positions and pick the longest route
  let bestRoute = [];
  const startCandidates = [];

  // Gather all valid cell positions
  for (const cell of dayAt.values()) {
    startCandidates.push({ col: cell.col, row: cell.row });
  }

  shuffle(startCandidates);

  // Try up to 30 random starts to find a good Hamiltonian path
  const attempts = Math.min(30, startCandidates.length);
  for (let i = 0; i < attempts; i += 1) {
    const start = startCandidates[i];
    const route = attemptHamiltonianWalk(start.col, start.row);

    if (route.length > bestRoute.length) {
      bestRoute = route;
    }

    // Perfect path found — visit every cell
    if (bestRoute.length === totalCells) break;
  }

  return bestRoute.map((cell) => ({
    col: cell.col,
    row: cell.row,
    day: cell.day,
    key: cellKey(cell.col, cell.row),
  }));
}

function buildGameState(route) {
  const eatenStepByKey = new Map();
  const eatenCountByStep = [];
  let eatenCount = 0;

  route.forEach((cell, stepIndex) => {
    if (cell.day.contributionCount > 0 && !eatenStepByKey.has(cell.key)) {
      eatenStepByKey.set(cell.key, stepIndex);
      eatenCount += 1;
    }

    eatenCountByStep.push(eatenCount);
  });

  return {
    eatenStepByKey,
    eatenCountByStep,
    foodCount: eatenCount,
  };
}

function keyTimes(length) {
  if (length <= 1) return "0;1";

  return Array.from({ length }, (_, index) => {
    const value = index / (length - 1);
    return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }).join(";");
}

function coord(value, base, step) {
  return base + value * step;
}

function animationValues(values) {
  return values.join(";");
}

function foodAnimation(stepIndex, routeLength) {
  const at = routeLength <= 1 ? 0.5 : stepIndex / (routeLength - 1);
  const vanishStart = Math.max(0, Math.min(0.992, at));
  const vanishEnd = Math.min(0.997, vanishStart + 0.003);

  return `<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;${vanishStart.toFixed(4)};${vanishEnd.toFixed(4)};1" dur="${animationDuration}" repeatCount="indefinite"/>`;
}

function contributionCells(weeks, eatenStepByKey, routeLength, layout) {
  const colors = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];

  return weeks
    .map((week, col) =>
      week.contributionDays
        .map((day) => {
          const row = day.weekday;
          const x = coord(col, layout.gridX, layout.step);
          const y = coord(row, layout.gridY, layout.step);
          const level = Math.max(0, Math.min(4, day.level || 0));
          const title = `${day.date}: ${day.contributionCount} contribution${day.contributionCount === 1 ? "" : "s"}`;
          const foodStep = eatenStepByKey.get(cellKey(col, row));
          const food =
            day.contributionCount > 0
              ? `<rect x="${x}" y="${y}" width="${layout.cell}" height="${layout.cell}" rx="3" fill="${colors[level]}">
      ${foodAnimation(foodStep, routeLength)}
    </rect>`
              : "";

          return `<g>
    <title>${escapeXml(title)}</title>
    <rect x="${x}" y="${y}" width="${layout.cell}" height="${layout.cell}" rx="3" fill="#161b22"/>
    ${food}
  </g>`;
        })
        .join("\n")
    )
    .join("\n");
}

function snakeSegments(route, gameState, layout) {
  const baseLength = 6;
  const segmentCount = baseLength + gameState.foodCount;
  const frameTimes = keyTimes(route.length);
  const headX = [];
  const headY = [];

  const segments = Array.from({ length: segmentCount }, (_, segmentIndex) => {
    const xValues = [];
    const yValues = [];
    const opacityValues = [];
    const fill = segmentIndex === 0 ? "#dfff4f" : segmentIndex < 5 ? "#7ee787" : "#2ea043";
    const stroke = segmentIndex === 0 ? ` stroke="#faffb8" stroke-width="2"` : "";

    route.forEach((_, stepIndex) => {
      const currentLength = baseLength + gameState.eatenCountByStep[stepIndex];
      const routeIndex = stepIndex - segmentIndex;
      const visible = routeIndex >= 0 && segmentIndex < currentLength;
      const cell = visible ? route[routeIndex] : route[0];
      const x = coord(cell.col, layout.gridX, layout.step);
      const y = coord(cell.row, layout.gridY, layout.step);

      xValues.push(x);
      yValues.push(y);
      opacityValues.push(visible ? Math.max(0.48, 0.98 - segmentIndex * 0.007).toFixed(2) : "0");

      if (segmentIndex === 0) {
        headX.push(x);
        headY.push(y);
      }
    });

    return `<rect x="${xValues[0]}" y="${yValues[0]}" width="${layout.cell}" height="${layout.cell}" rx="4" fill="${fill}"${stroke}>
    <animate attributeName="x" values="${animationValues(xValues)}" keyTimes="${frameTimes}" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete"/>
    <animate attributeName="y" values="${animationValues(yValues)}" keyTimes="${frameTimes}" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete"/>
    <animate attributeName="opacity" values="${animationValues(opacityValues)}" keyTimes="${frameTimes}" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete"/>
  </rect>`;
  }).join("\n");

  const leftEyeX = headX.map((x) => x + 4);
  const rightEyeX = headX.map((x) => x + 9);
  const eyeY = headY.map((y) => y + 4);

  return `<g>
  ${segments}
  <rect x="${leftEyeX[0]}" y="${eyeY[0]}" width="2" height="2" rx="1" fill="#0d1117">
    <animate attributeName="x" values="${animationValues(leftEyeX)}" keyTimes="${frameTimes}" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete"/>
    <animate attributeName="y" values="${animationValues(eyeY)}" keyTimes="${frameTimes}" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete"/>
  </rect>
  <rect x="${rightEyeX[0]}" y="${eyeY[0]}" width="2" height="2" rx="1" fill="#0d1117">
    <animate attributeName="x" values="${animationValues(rightEyeX)}" keyTimes="${frameTimes}" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete"/>
    <animate attributeName="y" values="${animationValues(eyeY)}" keyTimes="${frameTimes}" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete"/>
  </rect>
</g>`;
}

function legend(layout) {
  const colors = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
  const x = layout.gridX + layout.gridWidth - 188;
  const y = layout.gridY + layout.gridHeight + 24;

  return `<g>
  <text x="${x}" y="${y + 12}" class="muted">LESS</text>
  ${colors
    .map(
      (color, index) =>
        `<rect x="${x + 48 + index * 23}" y="${y}" width="16" height="16" rx="4" fill="${color}"/>`
    )
    .join("\n")}
  <text x="${x + 168}" y="${y + 12}" class="muted">MORE</text>
</g>`;
}

function arcadeCorners(width, panelTop, panelBottom) {
  const left = 26;
  const right = width - 26;
  const top = panelTop + 16;
  const bottom = panelBottom - 16;
  return `<g opacity="0.86">
  <path d="M${left} ${panelTop + 16}H${left + 50}M${left} ${panelTop + 16}V${panelTop + 66}" stroke="#39d353" stroke-width="3"/>
  <path d="M${right} ${panelTop + 16}H${right - 50}M${right} ${panelTop + 16}V${panelTop + 66}" stroke="#39d353" stroke-width="3"/>
  <path d="M${left} ${panelBottom - 16}H${left + 50}M${left} ${panelBottom - 16}V${panelBottom - 66}" stroke="#39d353" stroke-width="3"/>
  <path d="M${right} ${panelBottom - 16}H${right - 50}M${right} ${panelBottom - 16}V${panelBottom - 66}" stroke="#39d353" stroke-width="3"/>
</g>`;
}

function renderSvg(calendar) {
  const weeks = calendar.weeks;
  const route = buildRoute(weeks);
  const gameState = buildGameState(route);
  const layout = {
    gridX: 74,
    gridY: 150,
    cell: 13,
    gap: 4,
    step: 17,
  };
  layout.gridWidth = weeks.length * layout.cell + (weeks.length - 1) * layout.gap;
  layout.gridHeight = 7 * layout.cell + 6 * layout.gap;

  const width = 1000;
  const panelTop = 92;
  const panelBottom = panelTop + layout.gridHeight + 100;
  const height = panelBottom + 30;
  const score = calendar.totalContributions;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(username)} arcade contribution snake</title>
  <desc id="desc">An arcade snake animation built from ${score} real GitHub contributions. The snake grows when it eats active contribution cells.</desc>
  <style>
    .title { font: 800 28px Arial, sans-serif; fill: #f0f6fc; }
    .hud { font: 800 13px "Courier New", monospace; letter-spacing: 1.6px; fill: #39d353; }
    .muted { font: 700 13px Arial, sans-serif; fill: #8b949e; }
    .month { font: 700 13px Arial, sans-serif; fill: #f0f6fc; }
    .weekday { font: 700 13px Arial, sans-serif; fill: #f0f6fc; }
  </style>
  <defs>
    <linearGradient id="panel" x1="24" y1="${panelTop}" x2="976" y2="${panelBottom}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0d1117"/>
      <stop offset="1" stop-color="#070b11"/>
    </linearGradient>
    <radialGradient id="arcadeGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(770 124) rotate(118) scale(340 590)">
      <stop stop-color="#39d353" stop-opacity="0.24"/>
      <stop offset="0.45" stop-color="#1f6feb" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#0d1117" stop-opacity="0"/>
    </radialGradient>
    <pattern id="scanlines" width="6" height="6" patternUnits="userSpaceOnUse">
      <path d="M0 0H6" stroke="#f0f6fc" stroke-opacity="0.035"/>
    </pattern>
    <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#39d353" flood-opacity="0.65"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" rx="18" fill="#0d1117"/>
  <rect width="${width}" height="${height}" rx="18" fill="url(#arcadeGlow)"/>
  <rect width="${width}" height="${height}" rx="18" fill="url(#scanlines)"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="17" stroke="#30363d"/>

  <text x="42" y="58" class="title">${score} contributions in the last year</text>
  <text x="958" y="58" text-anchor="end" class="hud">ARCADE MODE // SNAKE RUN</text>

  <rect x="24" y="${panelTop}" width="952" height="${panelBottom - panelTop}" rx="12" fill="url(#panel)" stroke="#30363d" stroke-width="2"/>
  ${arcadeCorners(width, panelTop, panelBottom)}

  ${monthLabels(weeks)
    .map(
      (month) =>
        `<text x="${coord(month.weekIndex, layout.gridX, layout.step)}" y="128" class="month">${escapeXml(
          month.label
        )}</text>`
    )
    .join("\n")}

  <text x="68" y="${coord(1, layout.gridY, layout.step) + 12}" text-anchor="end" class="weekday">Mon</text>
  <text x="68" y="${coord(3, layout.gridY, layout.step) + 12}" text-anchor="end" class="weekday">Wed</text>
  <text x="68" y="${coord(5, layout.gridY, layout.step) + 12}" text-anchor="end" class="weekday">Fri</text>

  <g>
    ${contributionCells(weeks, gameState.eatenStepByKey, route.length, layout)}
  </g>

  <g filter="url(#softGlow)">
    ${snakeSegments(route, gameState, layout)}
  </g>

  ${legend(layout)}
</svg>
`;
}

async function main() {
  const calendar = await fetchCalendar();
  const svg = renderSvg(calendar).replace(/[ \t]+$/gm, "");

  await fs.mkdir(output.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await fs.writeFile(output, svg);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
