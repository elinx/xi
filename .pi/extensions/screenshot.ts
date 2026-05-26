import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FNM_NODE_BIN = "/Users/xilinxing/.local/share/fnm/node-versions/v22.22.3/installation/bin";

function getEnvWithPath(): Record<string, string> {
  const envPath = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: envPath.includes(FNM_NODE_BIN)
      ? envPath
      : `${FNM_NODE_BIN}:${envPath}`,
  } as Record<string, string>;
}

const screenshotTool = defineTool({
  name: "screenshot",
  label: "Screenshot",
  description:
    "Capture a screenshot. Returns the screenshot as a PNG image. " +
    "Use this when you need to see what's on the user's screen, debug a visual issue, " +
    "or analyze a webpage. Supports capturing a URL (renders in headless browser) " +
    "or the user's display (macOS only).",
  promptSnippet: "Capture a screenshot",
  promptGuidelines: [
    "Use screenshot when the user asks you to look at their screen or debug a visual issue.",
    "After capturing, describe what you see and offer relevant next steps.",
  ],
  parameters: Type.Object({
    url: Type.Optional(
      Type.String({ description: "URL to screenshot (opens in headless browser)" })
    ),
    display: Type.Optional(
      Type.Number({ description: "Display number for screen capture (default: 1)" })
    ),
    region: Type.Optional(
      Type.String({ description: "Region to capture as x,y,width,height (macOS screencapture -R)" })
    ),
  }),

  async execute(_toolCallId, params, signal, onUpdate, _ctx) {
    if (params.url) {
      return captureUrl(params.url, signal, onUpdate);
    }
    return captureScreen(params.display, params.region, signal, onUpdate);
  },
});

async function captureUrl(
  url: string,
  signal: AbortSignal | undefined,
  onUpdate: (update: { content: Array<{ type: "text"; text: string }> }) => void,
) {
  onUpdate({ content: [{ type: "text", text: `Loading ${url}...` }] });

  const tmpPath = join(tmpdir(), `pi-screenshot-url-${Date.now()}.png`);

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = execFile(
        "npx",
        [
          "playwright",
          "screenshot",
          "--wait-for-timeout",
          "1000",
          url,
          tmpPath,
        ],
        { signal: signal ?? undefined, timeout: 30000, env: getEnvWithPath() },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });

    return await readAndReturn(tmpPath, `Screenshot of ${url}`);
  } catch {
    await unlink(tmpPath).catch(() => {});
    throw new Error(`Failed to screenshot URL: ${url}. Make sure playwright is installed (npm i playwright && npx playwright install chromium)`);
  }
}

async function captureScreen(
  display: number | undefined,
  region: string | undefined,
  signal: AbortSignal | undefined,
  onUpdate: (update: { content: Array<{ type: "text"; text: string }> }) => void,
) {
  const displayNum = display ?? 1;
  onUpdate({ content: [{ type: "text", text: `Capturing display ${displayNum}...` }] });

  const tmpPath = join(tmpdir(), `pi-screenshot-${Date.now()}.png`);

  try {
    const args = ["-x", `-D${displayNum}`];
    if (region) {
      args.push("-R", region);
    }
    args.push(tmpPath);

    await new Promise<void>((resolve, reject) => {
      execFile("screencapture", args, { signal: signal ?? undefined, timeout: 10000 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    return await readAndReturn(tmpPath, `Screenshot from display ${displayNum}`);
  } catch {
    await unlink(tmpPath).catch(() => {});
    throw new Error("Failed to capture screenshot. screencapture command failed (macOS only).");
  }
}

async function readAndReturn(tmpPath: string, description: string) {
  const imageBuffer = await readFile(tmpPath);
  const base64Data = imageBuffer.toString("base64");
  await unlink(tmpPath).catch(() => {});
  return {
    content: [
      { type: "text" as const, text: description },
      { type: "image" as const, data: base64Data, mimeType: "image/png" },
    ],
    details: { path: tmpPath },
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(screenshotTool);
}
