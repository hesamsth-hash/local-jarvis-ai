// Bug-checks for the local intent brain — offline routing only, no network.
// The fs dispatcher and tool hooks are faked; assertions check ROUTING and
// argument extraction, not LLM behavior.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runBrain, type BrainDeps } from "../src/lib/jarvis/brain";
import type { ToolResult } from "../src/lib/jarvis/tools";
import { runFsAction } from "../src/lib/jarvis/brain-fs";
import { makeFakeBackend } from "./fs-backend.test";
import { setBackend } from "../src/lib/jarvis/fs-tools";

let connected = true;

function makeDeps(overrides: Partial<BrainDeps> = {}): BrainDeps {
  connected = overrides.connected ?? true;
  return {
    speak: async () => {},
    connected: true,
    connectFolder: async () => true,
    toolCtx: {
      // fs sub-actions dispatch through the REAL fs router (integration-style);
      // everything else is stubbed so no network/native bridge is touched.
      sub: async (action, arg): Promise<ToolResult> =>
        action === "fs"
          ? runFsAction(arg ?? "", () => connected)
          : { ok: true, data: `sub:${action}:${arg ?? ""}` },
    },
    llm: { provider: "pollinations", model: "test", baseUrl: "http://x", apiKey: "" },
    llmReady: false,
    ...overrides,
  } as BrainDeps;
}

describe("brain routing (offline intents)", () => {
  beforeEach(() => {
    setBackend(makeFakeBackend());
  });
  afterEach(() => {
    setBackend(null);
  });

  test("test voice intent fires", async () => {
    const r = await runBrain("test voice", makeDeps());
    expect(r.intent).toBe("audio.test");
    expect(r.reply).toMatch(/audio check/i);
  });

  test("volume to percent clamps and routes", async () => {
    const ok = await runBrain("volume 40", makeDeps());
    expect(ok.intent).toBe("audio.volume");
    expect(ok.reply).toContain("40");

    const clamp = await runBrain("volume 250", makeDeps());
    expect(clamp.reply).toContain("100");
  });

  test("use headphones routes through the headphones helper", async () => {
    let called = false;
    const deps = makeDeps({
      useHeadphones: async () => {
        called = true;
        return "Audio routed to Test Headset.";
      },
    });
    const r = await runBrain("use headphones", deps);
    expect(called).toBe(true);
    expect(r.reply).toContain("Test Headset");
  });

  test("headphones helper missing still answers (no crash)", async () => {
    const r = await runBrain("switch to my headset please", makeDeps());
    expect(r.reply).toBeTruthy();
  });

  test("set microphone to X extracts the name", async () => {
    let got: string | null = null;
    const deps = makeDeps({
      onAudioInput: (id) => {
        got = id;
      },
    });
    await runBrain("set microphone to airpods", deps);
    expect(got).toBe("__by_name__:airpods");
  });

  test("microphone back to default clears the pick", async () => {
    let got: string | null | undefined;
    const deps = makeDeps({
      onAudioInput: (id) => {
        got = id;
      },
    });
    const r = await runBrain("set microphone to default", deps);
    expect(got).toBeNull();
    expect(r.intent).toBe("audio.input");
  });

  test("wake word / hands-free voice modes toggle", async () => {
    const flags: Record<string, boolean> = {};
    const deps = makeDeps({
      onWakeWord: (on) => {
        flags.wake = on;
      },
      onHandsFree: (on) => {
        flags.hf = on;
      },
    });
    expect((await runBrain("wake word on", deps)).intent).toBe("voice.wake");
    expect(flags.wake).toBe(true);
    expect((await runBrain("hands-free off", deps)).intent).toBe("voice.modes");
    expect(flags.hf).toBe(false);
    expect(flags.wake).toBe(false);
  });

  test("duplicate find routes to fs with a pattern", async () => {
    const r = await runBrain("find duplicates *.jpg", makeDeps());
    expect(r.intent).toBe("fs.duplicates");
    expect(r.ok).toBe(true);
  });

  test("duplicate delete requires confirm", async () => {
    // seed two identical files so there IS something to delete
    const { writeFileBytes } = await import("../src/lib/jarvis/fs-tools");
    await writeFileBytes("photo.jpg", new Uint8Array([3, 1, 4]));
    await writeFileBytes("photo copy.jpg", new Uint8Array([3, 1, 4]));

    const gate = await runBrain("delete duplicates", makeDeps());
    expect(gate.reply).toMatch(/confirm/i);

    const confirmed = await runBrain("delete duplicates confirm", makeDeps());
    expect(confirmed.reply).toMatch(/deleted 1 duplicate/i);
  });

  test("zip without connection asks to connect first", async () => {
    const r = await runBrain("zip stuff into s.zip", makeDeps({ connected: false }));
    expect(r.ok).toBe(false);
    expect(r.reply).toMatch(/connect/i);
  });

  test("time and date still answer", async () => {
    expect((await runBrain("time", makeDeps())).intent).toBe("time");
    expect((await runBrain("date", makeDeps())).intent).toBe("date");
  });

  test("greetings survive the new intents", async () => {
    const r = await runBrain("hello", makeDeps());
    expect(r.ok).toBe(true);
    expect(r.reply.length).toBeGreaterThan(2);
  });

  test("help lists the new commands", async () => {
    const r = await runBrain("help", makeDeps());
    expect(r.reply).toContain("zip");
    expect(r.reply).toContain("duplicates");
  });
});
