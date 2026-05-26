import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;

    const command: string = event.input.command;
    if (typeof command !== "string") return;

    const blocked = [
      { pattern: /\bopen\s+.*\.html\b/, reason: "HTML files are rendered inline in the GUI. Do not open them in the browser." },
      { pattern: /\bopen\s+/, reason: "Do not use the 'open' command. The GUI handles file display." },
    ];

    for (const rule of blocked) {
      if (rule.pattern.test(command)) {
        return { block: true, reason: rule.reason };
      }
    }
  });
}
