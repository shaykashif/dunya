import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
const dir = path.resolve(process.argv[2]);
const { recStart, times } = JSON.parse(fs.readFileSync(path.join(dir, "sync.json")));
const aOff = recStart; // audio starts at recStart (wall clock)
const lines = [];
for (let i = 0; i < times.length; i++) {
  const d = i + 1 < times.length ? times[i + 1] - times[i] : 0.04;
  lines.push(`file 'f${String(i).padStart(5, "0")}.jpg'`, `duration ${Math.max(d, 0.001).toFixed(4)}`);
}
lines.push(`file 'f${String(times.length - 1).padStart(5, "0")}.jpg'`);
fs.writeFileSync(path.join(dir, "frames.txt"), lines.join("\n"));
const lead = Math.max(0, recStart - times[0]); // video frames before audio began
const trimV = Math.max(0, recStart - times[0]);
console.log("frames", times.length, "span", (times.at(-1) - times[0]).toFixed(1), "audio lead", lead.toFixed(2));
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "frames.txt", "-i", "audio.webm",
  "-ss", String(trimV), "-vf", "fps=30,format=yuv420p", "-af", "afade=t=in:d=0.3,afade=t=out:st=40.5:d=1.5,volume=1.5,alimiter=limit=0.95",
  "-c:v", "libx264", "-crf", "21", "-preset", "slow", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", "battle_promo.mp4"], { cwd: dir, stdio: "inherit" });
