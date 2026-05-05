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
      const contributionCount = [0, 0, 1, 0, 2, 0, 3][(week + day) % 7];
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
  if (!token) return fallbackCalendar();

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

function monthLabels(weeks, startX, step) {
  const labels = [];
  let previousMonth = "";

  weeks.forEach((week, index) => {
    const firstDay = week.contributionDays[0];
    if (!firstDay) return;

    const date = new Date(`${firstDay.date}T00:00:00Z`);
    const month = date.toLocaleString("en", { month: "short", timeZone: "UTC" });

    if (month !== previousMonth) {
      labels.push(
        `<text x="${startX + index * step}" y="26" fill="#8b949e" font-family="Arial, sans-serif" font-size="10">${month}</text>`
      );
      previousMonth = month;
    }
  });

  return labels.join("\n");
}

function renderSvg(calendar) {
  const weeks = calendar.weeks;
  const days = weeks.flatMap((week) => week.contributionDays);
  const max = Math.max(...days.map((day) => day.contributionCount), 1);

  const cell = 12;
  const gap = 4;
  const step = cell + gap;
  const startX = 34;
  const startY = 42;
  const graphWidth = weeks.length * step;
  const graphHeight = 7 * step;
  const width = Math.max(930, startX + graphWidth + 34);
  const height = 210;
  const raceY = startY + 58;
  const finishX = startX + graphWidth - 8;
  const raceLine = [
    `M ${startX - 10} ${raceY}`,
    `C ${startX + 120} ${startY - 4}, ${startX + 240} ${startY + 130}, ${startX + 370} ${raceY}`,
    `S ${startX + 620} ${startY + 16}, ${finishX} ${startY + 96}`,
  ].join(" ");

  const squares = weeks
    .map((week, weekIndex) =>
      week.contributionDays
        .map((day) => {
          const x = startX + weekIndex * step;
          const y = startY + day.weekday * step;
          const color = contributionColor(day.contributionCount, max);
          const title = `${day.date}: ${day.contributionCount} contribution${day.contributionCount === 1 ? "" : "s"}`;

          return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${color}">
  <title>${escapeXml(title)}</title>
</rect>`;
        })
        .join("\n")
    )
    .join("\n");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(username)} F1 contribution race</title>
  <desc id="desc">An animated F1 car racing across ${calendar.totalContributions} GitHub contributions.</desc>
  <style>
    .label { font: 600 14px Arial, sans-serif; fill: #f0f6fc; }
    .muted { font: 500 11px Arial, sans-serif; fill: #8b949e; }
    .line { stroke-dasharray: 14 10; animation: dash 1.1s linear infinite; }
    @keyframes dash { to { stroke-dashoffset: -24; } }
  </style>

  <rect width="${width}" height="${height}" rx="14" fill="#0d1117"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="13" stroke="#30363d"/>

  ${monthLabels(weeks, startX, step)}
  ${squares}

  <path id="race-line" d="${raceLine}" stroke="#f0f6fc" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
  <path d="${raceLine}" class="line" stroke="#e10600" stroke-width="3" stroke-linecap="round"/>

  <g transform="translate(${finishX + 10} ${startY + 78})">
    <rect x="0" y="0" width="10" height="10" fill="#f0f6fc"/>
    <rect x="10" y="10" width="10" height="10" fill="#f0f6fc"/>
    <rect x="10" y="0" width="10" height="10" fill="#0d1117"/>
    <rect x="0" y="10" width="10" height="10" fill="#0d1117"/>
    <path d="M0 0V42" stroke="#f0f6fc" stroke-width="2"/>
  </g>

  <g>
    <animateMotion dur="7s" repeatCount="indefinite" rotate="auto">
      <mpath href="#race-line" xlink:href="#race-line"/>
    </animateMotion>
    <g transform="translate(-25 -10)">
      <path d="M3 10L14 2H42L57 10L44 18H12L3 10Z" fill="#e10600"/>
      <path d="M20 6H35L42 10L34 13H20Z" fill="#f0f6fc"/>
      <path d="M0 10H60" stroke="#15151e" stroke-width="3" stroke-linecap="round"/>
      <circle cx="15" cy="19" r="5" fill="#010409"/>
      <circle cx="46" cy="19" r="5" fill="#010409"/>
      <circle cx="15" cy="19" r="2" fill="#8b949e"/>
      <circle cx="46" cy="19" r="2" fill="#8b949e"/>
      <path d="M5 8H-8" stroke="#ffcd00" stroke-width="3" stroke-linecap="round"/>
      <path d="M5 13H-15" stroke="#ff8700" stroke-width="3" stroke-linecap="round"/>
    </g>
  </g>

  <text x="34" y="${height - 28}" class="label">${calendar.totalContributions} contributions</text>
  <text x="${width - 250}" y="${height - 28}" class="muted">animated F1 race line</text>
</svg>
`;
}

async function main() {
  let calendar;

  try {
    calendar = await fetchCalendar();
  } catch (error) {
    console.warn(error.message);
    calendar = fallbackCalendar();
  }

  await fs.mkdir(output.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await fs.writeFile(output, renderSvg(calendar));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
