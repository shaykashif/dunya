// A one-tap result card: the verdict, the losses and the seed on a 1200x630 picture, shared through
// the system share sheet where there is one, or saved as a PNG with the link copied.
export interface ShareData {
  seed: number;
  place: string;
  headline: string;
  detail: string;
  us: { name: string; men: number; dead: number; wounded: number };
  de: { name: string; men: number; dead: number; wounded: number };
  rounds: number;
  url: string;
}

function lines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(" ")) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > max && cur) {
      out.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

export function drawCard(d: ShareData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 630;
  const g = c.getContext("2d")!;
  g.fillStyle = "#16180f";
  g.fillRect(0, 0, 1200, 630);
  g.strokeStyle = "#535a3a";
  g.lineWidth = 6;
  g.strokeRect(12, 12, 1176, 606);
  g.fillStyle = "#e8c84a";
  g.font = "28px Silkscreen, monospace";
  g.fillText("BOCAGE · BATTLE SIMULATION", 48, 72);
  g.fillStyle = "#a8a888";
  g.font = "30px VT323, monospace";
  g.fillText(d.place, 48, 108);
  g.fillStyle = "#ece6cc";
  g.font = "58px Silkscreen, monospace";
  const head = lines(g, d.headline.toUpperCase(), 1100);
  head.slice(0, 2).forEach((l, i) => g.fillText(l, 48, 190 + i * 66));
  g.fillStyle = "#d8d0b8";
  g.font = "34px VT323, monospace";
  const detail = lines(g, d.detail, 1100);
  if (detail.length > 3) detail[2] = `${detail[2]!.replace(/[ ,.;:]+$/, "")}…`;
  detail.slice(0, 3).forEach((l, i) => g.fillText(l, 48, 340 + i * 38));
  const row = (y: number, s: ShareData["us"], col: string) => {
    g.fillStyle = col;
    g.font = "30px Silkscreen, monospace";
    g.fillText(s.name, 48, y);
    g.fillStyle = "#ece6cc";
    g.font = "38px VT323, monospace";
    g.textAlign = "right";
    g.fillText(`${s.men} men · ${s.dead} killed · ${s.wounded} wounded`, 1152, y);
    g.textAlign = "left";
  };
  row(480, d.us, "#e8d890");
  row(530, d.de, "#b8d0a8");
  g.fillStyle = "#a8a888";
  g.font = "28px VT323, monospace";
  g.fillText(`${d.rounds.toLocaleString("en")} rounds fired · seed ${d.seed}`, 48, 590);
  g.fillStyle = "#e8c84a";
  g.textAlign = "right";
  g.fillText(d.url.replace(/^https?:\/\//, ""), 1152, 590);
  g.textAlign = "left";
  return c;
}

/** Shares the card; resolves to what happened, for the button label. */
export async function shareResult(d: ShareData): Promise<"shared" | "saved" | "cancelled"> {
  const canvas = drawCard(d);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  const text = `${d.headline}. Replay this exact battle: ${d.url}`;
  if (blob) {
    const file = new File([blob], `bocage-seed-${d.seed}.png`, { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (x: unknown) => boolean };
    try {
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, url: d.url });
        return "shared";
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  try {
    await navigator.clipboard.writeText(d.url);
  } catch {
    // The link is in the address bar anyway.
  }
  return "saved";
}
