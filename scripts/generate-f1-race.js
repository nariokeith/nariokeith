const fs = require("fs/promises");

const username = process.env.USERNAME || "nariokeith";
const token = process.env.GITHUB_TOKEN;
const output = process.env.OUTPUT || "dist/f1-race.svg";

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
    if (graphqlCalendar) return graphqlCalendar;
  } catch (error) {
    console.warn(error.message);
  }

  try {
    return await fetchPublicCalendar();
  } catch (error) {
    console.warn(error.message);
  }

  return fallbackCalendar();
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function contributionColor(count, max) {
  if (count === 0) return "#161b22";
  const level = Math.max(1, Math.min(4, Math.ceil((count / Math.max(max, 1)) * 4)));
  return ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"][level];
}

function shade(color, amount) {
  const hex = color.replace("#", "");
  const parts = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const shifted = parts.map((part) => Math.max(0, Math.min(255, part + amount)));
  return `#${shifted.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function monthStats(weeks) {
  const stats = [];
  const byMonth = new Map();

  weeks
    .flatMap((week) => week.contributionDays)
    .sort((left, right) => left.date.localeCompare(right.date))
    .forEach((day) => {
      const date = new Date(`${day.date}T00:00:00Z`);
      const key = day.date.slice(0, 7);

      if (!byMonth.has(key)) {
        const stat = {
          key,
          label: date.toLocaleString("en", { month: "short", timeZone: "UTC" }),
          total: 0,
          days: [],
        };

        byMonth.set(key, stat);
        stats.push(stat);
      }

      const stat = byMonth.get(key);
      stat.total += day.contributionCount;
      stat.days.push(day);
    });

  return stats;
}

function telemetryStrip(months) {
  const maxMonth = Math.max(...months.map((month) => month.total), 1);
  const startX = 72;
  const endX = 892;
  const baseY = 550;
  const step = months.length > 1 ? (endX - startX) / (months.length - 1) : 0;

  const ticks = months
    .map((month, index) => {
      const x = startX + index * step;
      const height = month.total === 0 ? 4 : 7 + Math.round((month.total / maxMonth) * 20);
      const color = month.total === 0 ? "#30363d" : contributionColor(month.total, maxMonth);

      return `<g>
  <title>${escapeXml(month.label)}: ${month.total} contribution${month.total === 1 ? "" : "s"}</title>
  <rect x="${Number((x - 2).toFixed(2))}" y="${baseY - height}" width="4" height="${height}" rx="2" fill="${color}"/>
  <text x="${Number(x.toFixed(2))}" y="574" text-anchor="middle" class="month">${escapeXml(month.label)}</text>
</g>`;
    })
    .join("\n");

  return `<g>
  <path d="M${startX - 18} ${baseY}H${endX + 18}" stroke="#29313b" stroke-width="2" stroke-linecap="round"/>
  ${ticks}
</g>`;
}

function building(x, y, width, height, depth, color, accent, label, total) {
  const right = shade(color, -26);
  const top = shade(color, 24);
  const shadow = shade(color, -48);
  const floors = Math.max(1, Math.min(5, Math.floor(height / 18)));
  const windows = Array.from({ length: floors }, (_, index) => {
    const wy = y - height + 9 + index * 13;
    return `<rect x="${x + 4}" y="${wy}" width="${Math.max(2, width - 8)}" height="2" rx="1" fill="${accent}" opacity="${total > 0 ? 0.72 : 0.18}"/>`;
  }).join("");

  return `<g>
  <title>${escapeXml(label)}: ${total} contribution${total === 1 ? "" : "s"}</title>
  <path d="M${x} ${y - height}l${depth} -${depth * 0.55}h${width}l-${depth} ${depth * 0.55}z" fill="${top}"/>
  <path d="M${x + width} ${y - height}l${depth} -${depth * 0.55}v${height}l-${depth} ${depth * 0.55}z" fill="${right}"/>
  <rect x="${x}" y="${y - height}" width="${width}" height="${height}" fill="${color}"/>
  <path d="M${x} ${y}h${width}l${depth} -${depth * 0.55}h-${width}z" fill="${shadow}" opacity="0.55"/>
  ${windows}
</g>`;
}

function contributionCity(months) {
  const maxMonth = Math.max(...months.map((month) => month.total), 1);
  const anchors = [
    [64, 188],
    [118, 156],
    [178, 176],
    [242, 142],
    [306, 170],
    [370, 136],
    [436, 166],
    [502, 132],
    [570, 158],
    [638, 126],
    [708, 154],
    [780, 134],
    [846, 170],
  ];

  return months
    .slice(0, anchors.length)
    .map((month, index) => {
      const [x, y] = anchors[index];
      const activity = month.total / maxMonth;
      const mainHeight = month.total === 0 ? 18 : 30 + Math.round(activity * 80);
      const sideHeight = Math.max(14, Math.round(mainHeight * (0.52 + ((index % 3) * 0.12))));
      const color = month.total > 0 ? "#17202c" : "#111820";
      const accent = month.total > 0 ? contributionColor(month.total, maxMonth) : "#3d4652";

      return `<g opacity="${month.total > 0 ? 0.96 : 0.62}">
  ${building(x, y, 18, sideHeight, 8, shade(color, -8), accent, month.label, month.total)}
  ${building(x + 20, y + 7, 24, mainHeight, 10, color, accent, month.label, month.total)}
  ${building(x + 48, y + 14, 14, Math.max(12, Math.round(mainHeight * 0.42)), 7, shade(color, -12), accent, month.label, month.total)}
</g>`;
    })
    .join("\n");
}

function roadLines() {
  const lines = [
    "M54 86L184 42L318 74L438 42L572 76L714 44L858 78",
    "M72 164L210 122L360 156L492 118L630 146L812 116",
    "M54 244L220 206L352 226L514 198L672 230L858 194",
    "M98 336L254 292L410 320L566 278L718 318L876 288",
    "M114 420L284 386L450 408L620 366L806 408",
    "M164 52L126 150L172 236L132 332L204 466",
    "M296 58L274 138L318 210L286 306L340 438",
    "M440 50L402 148L470 242L424 344L488 452",
    "M596 64L548 160L624 250L570 354L648 474",
    "M754 54L694 166L784 252L734 356L824 452",
  ];

  return lines
    .map((line) => `<path d="${line}" stroke="#3d4652" stroke-width="2" fill="none" opacity="0.58"/>`)
    .join("\n");
}

function renderSvg(calendar) {
  const weeks = calendar.weeks;
  const days = weeks.flatMap((week) => week.contributionDays);
  const months = monthStats(weeks);
  const bestDay = days.reduce((best, day) => (day.contributionCount > best.contributionCount ? day : best), {
    date: "",
    contributionCount: 0,
  });
  const width = 1000;
  const height = 620;
  // Public-domain Circuit Monaco.svg path from Wikimedia Commons, based on the official circuit map.
  const monacoTrack =
    "M 104.50658,653.97079 C 104.50658,653.97079 84.965034,629.56873 79.834481,596.08515 C 79.834481,596.08515 74.973956,554.23062 75.243997,532.3584 C 75.243997,532.3584 77.404225,475.92227 85.50508,450.80965 C 85.50508,450.80965 93.335916,414.35577 109.26763,387.89296 L 130.86994,353.05921 C 130.86994,353.05921 134.82662,338.97228 148.55254,344.16813 C 148.55254,344.16813 164.35349,348.1987 189.46616,348.1987 L 339.60219,344.95836 C 339.60219,344.95836 350.40331,344.41832 369.57538,337.39752 C 369.57538,337.39752 382.80679,333.6172 398.73845,333.6172 L 464.89557,330.64679 C 464.89557,330.64679 470.02615,332.80707 485.68779,322.27592 L 501.88952,308.50449 C 501.88952,308.50449 510.80047,296.08313 508.91022,291.22263 C 508.91022,291.22263 509.45033,284.20187 507.29006,278.53133 L 486.7679,237.48687 C 486.7679,237.48687 482.17744,228.90319 483.44088,219.42358 C 483.44088,219.42358 483.46952,211.9309 486.48858,209.16245 L 578.03766,122.45467 C 578.03766,122.45467 589.37879,111.92347 595.31947,111.92347 C 595.31947,111.92347 605.04054,109.49323 604.23043,121.10449 C 604.23043,121.10449 603.96043,158.09841 606.9307,172.13996 L 610.98113,190.77187 C 610.98113,190.77187 612.06126,202.38316 621.24229,200.76303 C 621.24229,200.76303 629.07308,200.49299 629.34315,190.77187 L 628.533,162.68893 C 628.533,162.68893 625.56265,148.37737 642.57452,147.83732 L 670.11743,146.75721 C 670.11743,146.75721 681.72868,145.13703 679.2984,160.52866 L 671.4676,194.01228 C 671.4676,194.01228 651.48542,262.59958 609.3609,309.5846 C 609.3609,309.5846 552.9249,355.21942 502.4296,366.29061 C 502.4296,366.29061 485.68779,372.23126 445.4535,373.58144 L 349.85202,375.86671 C 349.85202,375.86671 345.85264,380.74992 346.08288,385.46271 L 345.12781,394.57255 C 345.12781,394.57255 336.70589,395.4736 333.41139,395.55892 L 310.68925,395.55892 L 300.98805,390.32318 C 300.98805,390.32318 291.8071,382.2223 281.81601,384.38256 L 221.59959,384.65261 L 180.2852,386.27274 C 180.2852,386.27274 161.65323,385.46271 154.63245,402.47446 C 154.63245,402.47446 143.70623,423.70454 134.42303,477.53919 L 140.46862,483.78999 C 140.46862,483.78999 143.75175,485.72297 144.35154,493.48856 L 145.51777,552.0814 C 145.51777,552.0814 145.45152,560.71138 133.03009,576.91313 C 133.03009,576.91313 124.37277,587.95117 130.04328,610.09356 C 130.04328,610.09356 138.7007,636.31942 162.46329,654.41137 C 162.46329,654.41137 180.01513,670.61309 191.6264,674.93354 C 191.6264,674.93354 205.93792,680.33415 204.04778,693.83555 C 204.04778,693.83555 204.04778,703.82663 190.27624,703.28655 L 116.34799,695.18571 C 116.34799,695.18571 102.80682,695.4359 106.85727,682.20447 C 106.85727,682.20447 115.06333,666.1136 104.50658,653.97079 z";

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(username)} Monaco contribution circuit</title>
  <desc id="desc">A polished 3D Monaco circuit showing ${calendar.totalContributions} real GitHub contributions as skyline height and telemetry.</desc>
  <style>
    .title { font: 800 28px Arial, sans-serif; letter-spacing: 3px; fill: #f0f6fc; }
    .subtitle { font: 600 12px Arial, sans-serif; letter-spacing: 2px; fill: #8b949e; }
    .label { font: 700 14px Arial, sans-serif; fill: #f0f6fc; }
    .muted { font: 600 11px Arial, sans-serif; fill: #8b949e; }
    .month { font: 600 10px Arial, sans-serif; fill: #8b949e; }
    .track-label { font: 700 10px Arial, sans-serif; letter-spacing: 1px; fill: #aeb7c2; }
  </style>
  <defs>
    <linearGradient id="sea" x1="660" y1="300" x2="970" y2="600" gradientUnits="userSpaceOnUse">
      <stop stop-color="#092536"/>
      <stop offset="1" stop-color="#05131d"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(520 280) rotate(90) scale(260 420)">
      <stop stop-color="#e10600" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#e10600" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="14" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" rx="18" fill="#0d1117"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="17" stroke="#30363d"/>
  <path d="M632 354C710 306 786 298 872 336C956 374 984 466 950 596H624C584 494 574 398 632 354Z" fill="url(#sea)" opacity="0.92"/>
  <rect width="${width}" height="${height}" rx="18" fill="url(#glow)"/>

  <text x="50%" y="42" text-anchor="middle" class="title">MONTE CARLO</text>
  <text x="50%" y="64" text-anchor="middle" class="subtitle">MONACO CONTRIBUTION CIRCUIT</text>

  <g transform="matrix(0.72,0,-0.08,0.56,258,82)">
    ${roadLines()}

    <g>
      ${contributionCity(months)}
    </g>

    <path d="${monacoTrack}" transform="translate(18 30)" stroke="#1d0304" stroke-width="42" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
    <path d="${monacoTrack}" transform="translate(10 18)" stroke="#5a0709" stroke-width="39" stroke-linecap="round" stroke-linejoin="round" opacity="0.98"/>
    <path d="${monacoTrack}" stroke="#f7f7f7" stroke-width="38" stroke-linecap="round" stroke-linejoin="round" filter="url(#shadow)"/>
    <path d="${monacoTrack}" stroke="#e10600" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${monacoTrack}" stroke="#ff6b6b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="22 18" opacity="0.9"/>

    <g transform="translate(118 680) rotate(6)">
      <rect x="0" y="0" width="9" height="9" fill="#f0f6fc"/>
      <rect x="9" y="9" width="9" height="9" fill="#f0f6fc"/>
      <rect x="9" y="0" width="9" height="9" fill="#0d1117"/>
      <rect x="0" y="9" width="9" height="9" fill="#0d1117"/>
      <path d="M0 0V38" stroke="#f0f6fc" stroke-width="2"/>
    </g>

    <text x="388" y="178" class="track-label">CASINO</text>
    <text x="654" y="344" class="track-label">TUNNEL</text>
    <text x="536" y="238" class="track-label">HAIRPIN</text>
    <text x="198" y="564" class="track-label">PISCINE</text>
    <text x="254" y="706" class="track-label">RASCASSE</text>
    <text x="46" y="714" class="track-label">START</text>
  </g>

  ${telemetryStrip(months)}
  <text x="52" y="590" class="label">${calendar.totalContributions} contributions</text>
  <text x="805" y="590" text-anchor="end" class="muted">best day: ${escapeXml(bestDay.date || "none")} / ${bestDay.contributionCount}</text>
</svg>
`;
}

async function main() {
  const calendar = await fetchCalendar();

  await fs.mkdir(output.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await fs.writeFile(output, renderSvg(calendar));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
