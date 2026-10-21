import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(projectRoot, process.argv[2] || "build");
const publicSiteRoot = "https://krapples.github.io/moelections/";
const imageWidth = 1200;
const imageHeight = 630;

const stateNames = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California", CO:"Colorado", CT:"Connecticut", DE:"Delaware", FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho", IL:"Illinois", IN:"Indiana", IA:"Iowa", KS:"Kansas", KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland", MA:"Massachusetts", MI:"Michigan", MN:"Minnesota", MS:"Mississippi", MO:"Missouri", MT:"Montana", NE:"Nebraska", NV:"Nevada", NH:"New Hampshire", NJ:"New Jersey", NM:"New Mexico", NY:"New York", NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma", OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina", SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont", VA:"Virginia", WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming"
};

const glyphs = {
  "A":["01110","10001","10001","11111","10001","10001","10001"], "B":["11110","10001","10001","11110","10001","10001","11110"],
  "C":["01111","10000","10000","10000","10000","10000","01111"], "D":["11110","10001","10001","10001","10001","10001","11110"],
  "E":["11111","10000","10000","11110","10000","10000","11111"], "F":["11111","10000","10000","11110","10000","10000","10000"],
  "G":["01111","10000","10000","10111","10001","10001","01111"], "H":["10001","10001","10001","11111","10001","10001","10001"],
  "I":["11111","00100","00100","00100","00100","00100","11111"], "J":["00111","00010","00010","00010","10010","10010","01100"],
  "K":["10001","10010","10100","11000","10100","10010","10001"], "L":["10000","10000","10000","10000","10000","10000","11111"],
  "M":["10001","11011","10101","10101","10001","10001","10001"], "N":["10001","11001","10101","10011","10001","10001","10001"],
  "O":["01110","10001","10001","10001","10001","10001","01110"], "P":["11110","10001","10001","11110","10000","10000","10000"],
  "Q":["01110","10001","10001","10001","10101","10010","01101"], "R":["11110","10001","10001","11110","10100","10010","10001"],
  "S":["01111","10000","10000","01110","00001","00001","11110"], "T":["11111","00100","00100","00100","00100","00100","00100"],
  "U":["10001","10001","10001","10001","10001","10001","01110"], "V":["10001","10001","10001","10001","10001","01010","00100"],
  "W":["10001","10001","10001","10101","10101","10101","01010"], "X":["10001","10001","01010","00100","01010","10001","10001"],
  "Y":["10001","10001","01010","00100","00100","00100","00100"], "Z":["11111","00001","00010","00100","01000","10000","11111"],
  "0":["01110","10001","10011","10101","11001","10001","01110"], "1":["00100","01100","00100","00100","00100","00100","01110"],
  "2":["01110","10001","00001","00010","00100","01000","11111"], "3":["11110","00001","00001","01110","00001","00001","11110"],
  "4":["00010","00110","01010","10010","11111","00010","00010"], "5":["11111","10000","10000","11110","00001","00001","11110"],
  "6":["01110","10000","10000","11110","10001","10001","01110"], "7":["11111","00001","00010","00100","01000","01000","01000"],
  "8":["01110","10001","10001","01110","10001","10001","01110"], "9":["01110","10001","10001","01111","00001","00001","01110"],
  "+":["00000","00100","00100","11111","00100","00100","00000"], "-":["00000","00000","00000","11111","00000","00000","00000"],
  ".":["00000","00000","00000","00000","00000","00110","00110"], ",":["00000","00000","00000","00000","00110","00110","00100"],
  "%":["11001","11010","00100","01000","10110","00110","00000"], ":":["00000","00110","00110","00000","00110","00110","00000"],
  " ":["00000","00000","00000","00000","00000","00000","00000"]
};

const colors = {
  background:"#0b1220", panel:"#111d30", border:"#263750",
  white:"#f2f6fc", muted:"#9db0c9", blue:"#50aaff", red:"#ff7482", track:"#27364d", accent:"#a5d1ff"
};

function hexRgb(value) {
  return [1, 3, 5].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function makeCanvas(width, height, color) {
  const pixels = Buffer.alloc(width * height * 4);
  const [r, g, b] = hexRgb(color);
  const row = Buffer.alloc(width * 4);
  for (let index = 0; index < row.length; index += 4) {
    row[index] = r;
    row[index + 1] = g;
    row[index + 2] = b;
    row[index + 3] = 255;
  }
  for (let y = 0; y < height; y++) row.copy(pixels, y * row.length);
  return { width, height, pixels };
}

function rect(canvas, x, y, width, height, color) {
  const [r, g, b] = hexRgb(color);
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(canvas.width, Math.ceil(x + width));
  const bottom = Math.min(canvas.height, Math.ceil(y + height));
  for (let py = top; py < bottom; py++) {
    let offset = (py * canvas.width + left) * 4;
    for (let px = left; px < right; px++, offset += 4) {
      canvas.pixels[offset] = r;
      canvas.pixels[offset + 1] = g;
      canvas.pixels[offset + 2] = b;
      canvas.pixels[offset + 3] = 255;
    }
  }
}

function circle(canvas, cx, cy, radius, color) {
  const [r, g, b] = hexRgb(color);
  const square = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(canvas.height, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(canvas.width, Math.ceil(cx + radius)); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= square) {
        const offset = (y * canvas.width + x) * 4;
        canvas.pixels[offset] = r;
        canvas.pixels[offset + 1] = g;
        canvas.pixels[offset + 2] = b;
        canvas.pixels[offset + 3] = 255;
      }
    }
  }
}

function roundRect(canvas, x, y, width, height, radius, color) {
  rect(canvas, x + radius, y, width - 2 * radius, height, color);
  rect(canvas, x, y + radius, radius, height - 2 * radius, color);
  rect(canvas, x + width - radius, y + radius, radius, height - 2 * radius, color);
  circle(canvas, x + radius, y + radius, radius, color);
  circle(canvas, x + width - radius - 1, y + radius, radius, color);
  circle(canvas, x + radius, y + height - radius - 1, radius, color);
  circle(canvas, x + width - radius - 1, y + height - radius - 1, radius, color);
}

function drawText(canvas, value, x, y, scale, color) {
  const text = String(value).toUpperCase().replace(/[–—]/g, "-");
  const cellWidth = 6 * scale;
  for (let index = 0; index < text.length; index++) {
    const glyph = glyphs[text[index]] || glyphs[" "];
    for (let row = 0; row < 7; row++) {
      for (let column = 0; column < 5; column++) {
        if (glyph[row][column] === "1") rect(canvas, x + index * cellWidth + column * scale, y + row * scale, scale, scale, color);
      }
    }
  }
}

function centeredText(canvas, value, centerX, y, scale, color) {
  const width = String(value).length * 6 * scale - scale;
  drawText(canvas, value, Math.round(centerX - width / 2), y, scale, color);
}

function fitScale(value, maxWidth, maxScale, minScale = 2) {
  const length = Math.max(String(value).length, 1);
  return Math.max(minScale, Math.min(maxScale, Math.floor(maxWidth / (length * 6))));
}

function fullRaceName(race) {
  const state = stateNames[race.state] || race.state;
  if (race.office === "Senate") return state + " Senate";
  if (race.office === "Governor") return state + " Governor";
  const districtNumber = Number.parseInt(String(race.district || "0"), 10);
  return state + " " + (districtNumber === 0 ? "At-large" : "District " + districtNumber);
}

function formatMargin(value) {
  const margin = Number(value);
  if (!Number.isFinite(margin)) throw new Error("A published race margin is not finite.");
  if (Math.abs(margin) < 0.05) return "EVEN";
  return (margin > 0 ? "D+" : "R+") + Math.abs(margin).toFixed(1);
}

function displayDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("The current public forecast has an invalid snapshot date.");
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.valueOf())) throw new Error("The current public forecast snapshot date cannot be parsed.");
  return new Intl.DateTimeFormat("en-US", { year:"numeric", month:"long", day:"numeric", timeZone:"UTC" }).format(date);
}

function drawShareCard(race, snapshotDate) {
  const canvas = makeCanvas(imageWidth, imageHeight, colors.background);
  rect(canvas, 0, 0, imageWidth, 12, colors.blue);
  roundRect(canvas, 64, 42, 10, 38, 4, colors.blue);
  drawText(canvas, "MOELECTIONS", 92, 51, 4, colors.white);

  const dateText = snapshotDate.toUpperCase();
  roundRect(canvas, 857, 38, 278, 48, 15, colors.border);
  roundRect(canvas, 859, 40, 274, 44, 13, colors.panel);
  centeredText(canvas, dateText, 996, 55, fitScale(dateText, 246, 3, 2), colors.muted);

  rect(canvas, 64, 112, 1072, 2, colors.border);
  drawText(canvas, "2026 " + race.office + " FORECAST", 68, 143, 3, colors.accent);
  const name = fullRaceName(race);
  drawText(canvas, name, 64, 178, fitScale(name, 1068, 7, 4), colors.white);

  const margin = Number(race.dem_margin_pp);
  const dem = Number(race.dem_probability);
  const rep = Number(race.rep_probability);
  if (![margin, dem, rep].every(Number.isFinite) || dem < 0 || dem > 1 || rep < 0 || rep > 1 || Math.abs(dem + rep - 1) > 1e-10) {
    throw new Error("Published values are invalid for " + race.race_id + ".");
  }

  roundRect(canvas, 64, 270, 468, 240, 20, colors.border);
  roundRect(canvas, 66, 272, 464, 236, 18, colors.panel);
  roundRect(canvas, 558, 270, 578, 240, 20, colors.border);
  roundRect(canvas, 560, 272, 574, 236, 18, colors.panel);
  drawText(canvas, "D-R MARGIN", 96, 307, 3, colors.muted);
  const marginText = formatMargin(margin);
  drawText(canvas, marginText, 94, 358, fitScale(marginText, 400, 10, 7), margin > 0 ? colors.blue : margin < 0 ? colors.red : colors.white);
  drawText(canvas, "PERCENTAGE POINTS", 98, 461, 2, colors.muted);

  drawText(canvas, "WIN PROBABILITY", 592, 307, 3, colors.muted);
  drawText(canvas, "DEMOCRATS", 592, 350, 3, colors.blue);
  drawText(canvas, "REPUBLICANS", 847, 350, 3, colors.red);
  const demText = (dem * 100).toFixed(1) + "%";
  const repText = (rep * 100).toFixed(1) + "%";
  drawText(canvas, demText, 592, 394, fitScale(demText, 220, 7, 5), colors.white);
  drawText(canvas, repText, 847, 394, fitScale(repText, 250, 7, 5), colors.white);

  const barX = 592;
  const barY = 450;
  const barWidth = 506;
  const demWidth = Math.round(barWidth * dem);
  roundRect(canvas, barX, barY, barWidth, 18, 9, colors.track);
  if (demWidth > 0) roundRect(canvas, barX, barY, demWidth, 18, Math.min(9, demWidth / 2), colors.blue);
  if (barWidth - demWidth > 0) roundRect(canvas, barX + demWidth, barY, barWidth - demWidth, 18, Math.min(9, (barWidth - demWidth) / 2), colors.red);

  rect(canvas, 64, 548, 1072, 2, colors.border);
  drawText(canvas, "MARGIN AND WIN PROBABILITY ARE SEPARATE MEASURES", 68, 574, 2, colors.muted);
  return encodePng(canvas);
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  crcTable[n] = crc >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}

function encodePng(canvas) {
  const scanlines = Buffer.alloc(canvas.height * (canvas.width * 4 + 1));
  for (let y = 0; y < canvas.height; y++) {
    const rowOffset = y * (canvas.width * 4 + 1);
    scanlines[rowOffset] = 0;
    canvas.pixels.copy(scanlines, rowOffset + 1, y * canvas.width * 4, (y + 1) * canvas.width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level:9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[character] || character));
}

function setMeta(html, attribute, name, value) {
  const pattern = new RegExp("<meta\\s+" + attribute + "=\"" + name + "\"\\s+content=\"[^\"]*\"\\s*>");
  if (!pattern.test(html)) throw new Error("The source race page is missing metadata " + name + ".");
  return html.replace(pattern, "<meta " + attribute + "=\"" + name + "\" content=\"" + escapeHtml(value) + "\">");
}

function setCanonical(html, value) {
  const pattern = /<link\s+rel=\"canonical\"\s+href=\"[^\"]*\"\s*>/;
  if (!pattern.test(html)) throw new Error("The source race page is missing its canonical link.");
  return html.replace(pattern, "<link rel=\"canonical\" href=\"" + escapeHtml(value) + "\">");
}

function createRacePage(template, race, snapshotDate, dateText, name) {
  if (!/^[a-z0-9-]+$/.test(race.race_id)) throw new Error("Race ID is unsafe for a static filename: " + race.race_id);
  const filename = "race-" + race.race_id + ".html";
  const imageRelative = "social/race-" + race.race_id + ".png";
  const imageUrl = new URL(imageRelative, publicSiteRoot).href;
  const canonicalUrl = new URL(filename, publicSiteRoot).href;
  const title = name + " — Moelections 2026 Forecast";
  const margin = formatMargin(race.dem_margin_pp);
  const dem = (Number(race.dem_probability) * 100).toFixed(1) + "%";
  const rep = (Number(race.rep_probability) * 100).toFixed(1) + "%";
  const description = "2026 " + name + " forecast: D-R margin " + margin + " pp; Democratic win chance " + dem + "; Republican win chance " + rep + ". Snapshot: " + dateText + ".";
  const imageAlt = "2026 " + name + " forecast card showing D-R margin " + margin + " percentage points, Democratic win chance " + dem + ", Republican win chance " + rep + ", and snapshot date " + dateText + ".";
  let html = template.replace(/<title>[^<]*<\/title>/, "<title>" + escapeHtml(title) + "</title>");
  html = setCanonical(html, canonicalUrl);
  html = setMeta(html, "name", "description", description);
  html = setMeta(html, "property", "og:title", title);
  html = setMeta(html, "property", "og:description", description);
  html = setMeta(html, "property", "og:url", canonicalUrl);
  html = setMeta(html, "property", "og:image", imageUrl);
  html = setMeta(html, "property", "og:image:type", "image/png");
  html = setMeta(html, "property", "og:image:width", String(imageWidth));
  html = setMeta(html, "property", "og:image:height", String(imageHeight));
  html = setMeta(html, "property", "og:image:alt", imageAlt);
  html = setMeta(html, "name", "twitter:title", title);
  html = setMeta(html, "name", "twitter:description", description);
  html = setMeta(html, "name", "twitter:image", imageUrl);
  html = setMeta(html, "name", "twitter:image:alt", imageAlt);
  const raceMetadata = [
    "<meta name=\"moelections:race-id\" content=\"" + escapeHtml(race.race_id) + "\">",
    "<meta name=\"moelections:dem-margin-pp\" content=\"" + escapeHtml(Number(race.dem_margin_pp).toString()) + "\">",
    "<meta name=\"moelections:dem-win-probability\" content=\"" + escapeHtml(dem) + "\">",
    "<meta name=\"moelections:rep-win-probability\" content=\"" + escapeHtml(rep) + "\">",
    "<meta name=\"moelections:snapshot-date\" content=\"" + escapeHtml(snapshotDate) + "\">"
  ].join("\n  ");
  html = html.replace("</head>", "  " + raceMetadata + "\n</head>");
  if (!html.includes("<body data-page=\"race\">")) throw new Error("The source race page has an unexpected body marker.");
  html = html.replace("<body data-page=\"race\">", "<body data-page=\"race\" data-race-id=\"" + escapeHtml(race.race_id) + "\">");
  return { filename, imageRelative, html };
}

const currentPath = path.join(output, "data", "current.json");
const templatePath = path.join(output, "race.html");
if (!fs.existsSync(currentPath) || !fs.existsSync(templatePath)) throw new Error("Run this generator after Vite has created build/data/current.json and build/race.html.");
const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
const template = fs.readFileSync(templatePath, "utf8");
const snapshotDate = String(current.snapshot_date || "");
const dateText = displayDate(snapshotDate);
if (!Array.isArray(current.races) || !current.races.length) throw new Error("The public current snapshot has no races to generate.");
const seen = new Set();
const socialDirectory = path.join(output, "social");
fs.mkdirSync(socialDirectory, { recursive:true });
for (const race of current.races) {
  if (seen.has(race.race_id)) throw new Error("The public current snapshot has a duplicate race ID: " + race.race_id);
  seen.add(race.race_id);
  const name = fullRaceName(race);
  const generated = createRacePage(template, race, snapshotDate, dateText, name);
  fs.writeFileSync(path.join(output, generated.filename), generated.html);
  fs.writeFileSync(path.join(output, ...generated.imageRelative.split("/")), drawShareCard(race, dateText));
}
process.stdout.write("Generated " + seen.size + " race-specific static pages and PNG preview cards in " + output + ".\n");
