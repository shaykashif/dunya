import path from "node:path"; import { execFileSync } from "node:child_process";
const dir = path.resolve(process.argv[2]); const dur = process.argv[3] ?? "42";
execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "60", "-i", "f%05d.jpg", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "audio.pcm",
  "-t", dur, "-vf", "format=yuv420p", "-r", "60",
  "-af", `afade=t=in:d=0.3,afade=t=out:st=${Number(dur) - 1.5}:d=1.5,volume=1.5,alimiter=limit=0.95`,
  "-c:v", "libx264", "-crf", "25", "-preset", "slow", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", process.env.OUTNAME ?? "battle_promo_60.mp4"], { cwd: dir, stdio: "inherit" });
