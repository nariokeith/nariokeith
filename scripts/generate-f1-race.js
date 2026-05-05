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

function monthLabels(weeks) {
  const labels = [];
  let previousMonth = "";

  weeks.forEach((week, index) => {
    const firstDay = week.contributionDays[0];
    if (!firstDay) return;

    const date = new Date(`${firstDay.date}T00:00:00Z`);
    const month = date.toLocaleString("en", { month: "short", timeZone: "UTC" });

    if (month !== previousMonth) {
      labels.push(
        `<text x="${64 + index * 15}" y="554" class="month">${escapeXml(month)}</text>`
      );
      previousMonth = month;
    }
  });

  return labels.join("\n");
}

function contributionBlocks(weeks, max) {
  const blocks = [];

  weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((day) => {
      const x = 62 + weekIndex * 15;
      const y = 94 + day.weekday * 20 + (weekIndex % 2) * 2;
      const height = day.contributionCount === 0 ? 3 : 6 + Math.min(24, Math.round((day.contributionCount / Math.max(max, 1)) * 28));
      const color = contributionColor(day.contributionCount, max);
      const dark = shade(color, -30);
      const darker = shade(color, -48);
      const title = `${day.date}: ${day.contributionCount} contribution${day.contributionCount === 1 ? "" : "s"}`;

      blocks.push({
        y,
        markup: `<g>
  <title>${escapeXml(title)}</title>
  <path d="M${x} ${y - height}l7 -4l7 4l-7 4z" fill="${color}"/>
  <path d="M${x} ${y - height}l7 4v${height}l-7 -4z" fill="${dark}"/>
  <path d="M${x + 14} ${y - height}l-7 4v${height}l7 -4z" fill="${darker}"/>
</g>`,
      });
    });
  });

  return blocks
    .sort((left, right) => left.y - right.y)
    .map((block) => block.markup)
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

function relativeMotionPath(path, startX, startY) {
  return path.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_, rawX, rawY) => {
    const x = Number(rawX) - startX;
    const y = Number(rawY) - startY;
    return `${Number(x.toFixed(2))} ${Number(y.toFixed(2))}`;
  });
}

function renderSvg(calendar) {
  const weeks = calendar.weeks;
  const days = weeks.flatMap((week) => week.contributionDays);
  const max = Math.max(...days.map((day) => day.contributionCount), 1);
  const bestDay = days.reduce((best, day) => (day.contributionCount > best.contributionCount ? day : best), {
    date: "",
    contributionCount: 0,
  });
  const width = 1000;
  const height = 620;
  const monacoTrack = [
    "M234 448",
    "C182 420 170 354 214 310",
    "C264 260 366 258 476 264",
    "C592 270 668 236 714 174",
    "C766 104 846 126 856 198",
    "C866 270 792 310 720 292",
    "C662 278 640 238 672 208",
    "C705 176 763 178 786 140",
    "C818 88 770 44 700 58",
    "C628 72 600 130 558 174",
    "C516 218 450 224 416 194",
    "C386 168 404 126 452 120",
    "C510 112 530 64 482 44",
    "C414 14 340 58 320 124",
    "C296 202 252 228 190 208",
    "C126 188 82 238 106 302",
    "C132 370 150 420 234 448",
  ].join(" ");
  const carMotion = relativeMotionPath(monacoTrack, 234, 448);

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(username)} Monaco contribution circuit</title>
  <desc id="desc">A 3D Monaco style circuit showing ${calendar.totalContributions} real GitHub contributions as raised city blocks.</desc>
  <style>
    .title { font: 800 28px Arial, sans-serif; letter-spacing: 3px; fill: #f0f6fc; }
    .subtitle { font: 600 12px Arial, sans-serif; letter-spacing: 2px; fill: #8b949e; }
    .label { font: 700 14px Arial, sans-serif; fill: #f0f6fc; }
    .muted { font: 600 11px Arial, sans-serif; fill: #8b949e; }
    .month { font: 600 10px Arial, sans-serif; fill: #8b949e; }
    .pulse { animation: pulse 1.4s ease-in-out infinite; transform-origin: center; }
    .dash { stroke-dasharray: 18 14; animation: dash 1.2s linear infinite; }
    @keyframes dash { to { stroke-dashoffset: -32; } }
    @keyframes pulse { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; } }
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
    <filter id="shadow" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="0" dy="18" stdDeviation="14" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" rx="18" fill="#0d1117"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="17" stroke="#30363d"/>
  <path d="M632 354C710 306 786 298 872 336C956 374 984 466 950 596H624C584 494 574 398 632 354Z" fill="url(#sea)" opacity="0.92"/>
  <rect width="${width}" height="${height}" rx="18" fill="url(#glow)"/>

  <text x="50%" y="42" text-anchor="middle" class="title">MONTE CARLO</text>
  <text x="50%" y="64" text-anchor="middle" class="subtitle">MONACO CONTRIBUTION CIRCUIT</text>

  <g transform="matrix(0.82,0,-0.068,0.78,104,82)">
    ${roadLines()}

    <g opacity="0.82">
      ${contributionBlocks(weeks, max)}
    </g>

    <path d="${monacoTrack}" transform="translate(12 24)" stroke="#2a0507" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    <path d="${monacoTrack}" transform="translate(7 15)" stroke="#65090c" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
    <path d="${monacoTrack}" stroke="#f0f6fc" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" filter="url(#shadow)"/>
    <path id="monaco-track" d="${monacoTrack}" stroke="#e10600" stroke-width="23" stroke-linecap="round" stroke-linejoin="round"/>
    <path id="monaco-motion" d="${carMotion}" fill="none" stroke="none"/>
    <path d="${monacoTrack}" class="dash" stroke="#ff6b6b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>

    <g transform="translate(218 432) rotate(18)">
      <rect x="0" y="0" width="9" height="9" fill="#f0f6fc"/>
      <rect x="9" y="9" width="9" height="9" fill="#f0f6fc"/>
      <rect x="9" y="0" width="9" height="9" fill="#0d1117"/>
      <rect x="0" y="9" width="9" height="9" fill="#0d1117"/>
      <path d="M0 0V38" stroke="#f0f6fc" stroke-width="2"/>
    </g>

    <g transform="translate(234 448)">
      <animateMotion dur="9s" repeatCount="indefinite" rotate="auto">
        <mpath href="#monaco-motion" xlink:href="#monaco-motion"/>
      </animateMotion>
      <g transform="translate(-24 -11)">
        <path d="M3 11L15 2H42L58 11L45 20H13L3 11Z" fill="#e10600"/>
        <path d="M20 6H35L43 11L34 15H19Z" fill="#f0f6fc"/>
        <path d="M0 11H61" stroke="#15151e" stroke-width="3" stroke-linecap="round"/>
        <circle cx="15" cy="21" r="5" fill="#010409"/>
        <circle cx="47" cy="21" r="5" fill="#010409"/>
        <circle cx="15" cy="21" r="2" fill="#8b949e"/>
        <circle cx="47" cy="21" r="2" fill="#8b949e"/>
        <path d="M5 8H-8" stroke="#ffcd00" stroke-width="3" stroke-linecap="round"/>
        <path d="M5 15H-17" stroke="#ff8700" stroke-width="3" stroke-linecap="round"/>
      </g>
    </g>

    <text x="608" y="112" class="muted">CASINO</text>
    <text x="770" y="246" class="muted">TUNNEL</text>
    <text x="124" y="206" class="muted">MIRABEAU</text>
    <text x="158" y="476" class="muted">START</text>
    <text x="700" y="424" class="muted">PORT</text>
  </g>

  ${monthLabels(weeks)}
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
