import { motion } from "framer-motion";
import {
  ArrowRight,
  Brain,
  Cpu,
  FolderTree,
  Github,
  Lock,
  Mic,
  Puzzle,
  ShieldCheck,
  Volume2,
  WifiOff,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { Download } from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

const FEATURES = [
  {
    icon: Volume2,
    title: "Kokoro voice output",
    body: "An 82M-parameter neural voice rendered by WASM on your own CPU. Every reply is spoken aloud — no cloud calls, ever.",
    chip: "kokoro-js",
  },
  {
    icon: Brain,
    title: "Bring your own local LLM",
    body: "Plug in Ollama, KoboldCpp, LM Studio or llama.cpp. Your model becomes the brain and plans tool calls — weights stay on your machine.",
    chip: "ollama · kobold · lm studio",
  },
  {
    icon: Mic,
    title: "Whisper speech input",
    body: "Talk to your assistant hands-free. Whisper runs locally and turns speech into commands in seconds.",
    chip: "whisper-base",
  },
  {
    icon: FolderTree,
    title: "Real file superpowers",
    body: "Connect a folder and command it in plain language — list, read, write, rename, move, delete with trash and undo.",
    chip: "fs-tools",
  },
  {
    icon: Puzzle,
    title: "Twenty tools, one registry",
    body: "Web search, weather, YouTube, system monitor, screen & camera capture, code review, reminders, monitors — all visible and toggleable.",
    chip: "tool registry",
  },
  {
    icon: ShieldCheck,
    title: "Honest about limits",
    body: "A browser can't move your mouse or change system volume. JARVIS tells you exactly what needs a native bridge instead of faking it.",
    chip: "no smoke & mirrors",
  },
];

const STEPS = [
  {
    icon: ShieldCheck,
    title: "Sign in, locally first",
    body: "The console is yours alone. Command history syncs to your account; the brain never calls out.",
  },
  {
    icon: FolderTree,
    title: "Connect a workspace",
    body: "One click grants file access. Everything after that happens on-device with a trash-folder undo.",
  },
  {
    icon: Zap,
    title: "Speak and command",
    body: 'Say "list files" or "rename report to report-final" — JARVIS answers with voice and receipts.',
  },
];

export default function Landing() {
  const { canInstall, install, standalone } = usePwaInstall();
  return (
    <div className="bg-grid relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="aurora" />

      {/* Nav */}
      <header className="relative z-10">
        <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <Cpu className="size-4.5" />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">
              JARVIS
              <span className="ml-2 hidden font-mono text-[10px] font-normal uppercase tracking-widest text-muted-foreground sm:inline">
                local console
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="hidden rounded-full sm:inline-flex">
              <a href="#features">Features</a>
            </Button>
            <Button asChild variant="ghost" className="hidden rounded-full sm:inline-flex">
              <a href="#how">How it works</a>
            </Button>
            {canInstall && !standalone && (
              <Button
                variant="outline"
                className="gap-1.5 rounded-full"
                onClick={() => void install()}
              >
                <Download className="size-4" />
                Install app
              </Button>
            )}
            <Button asChild variant="outline" className="rounded-full">
              <a href="/dashboard">Open console</a>
            </Button>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-4 pb-16 pt-12 text-center sm:pt-20">
        <motion.div {...fadeUp} transition={{ duration: 0.5 }}>
          <Badge variant="outline" className="gap-1.5 rounded-full bg-card/60 px-3 py-1 font-mono text-[11px] backdrop-blur">
            <WifiOff className="size-3 text-primary" />
            100% on-device · no cloud · no API keys
          </Badge>
        </motion.div>

        <motion.h1
          {...fadeUp}
          transition={{ duration: 0.55, delay: 0.08 }}
          className="font-display mt-6 max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl"
        >
          Your own <span className="text-gradient">JARVIS</span>, running
          entirely on your machine
        </motion.h1>

        <motion.p
          {...fadeUp}
          transition={{ duration: 0.55, delay: 0.16 }}
          className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg"
        >
          A voice-first assistant with a local brain: Kokoro speaks, Whisper
          listens, and your own Ollama or KoboldCpp model plans real tools —
          file operations, web search, weather, screen capture and more — right
          inside your browser.
        </motion.p>

        <motion.div
          {...fadeUp}
          transition={{ duration: 0.55, delay: 0.24 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Button asChild size="lg" className="ring-glow h-12 rounded-full px-7 text-sm font-medium">
            <a href="/auth">
              Launch the console
              <ArrowRight className="ml-1 size-4" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-7 text-sm">
            <a href="#features">See what it can do</a>
          </Button>
        </motion.div>
        {canInstall && !standalone && (
          <p className="mt-4 text-xs text-muted-foreground">
            or{" "}
            <button
              className="font-medium text-primary underline underline-offset-2"
              onClick={() => void install()}
            >
              install JARVIS as a Windows app
            </button>{" "}
            — Start menu, own window, works offline
          </p>
        )}

        {/* Orb hero visual */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="relative mt-14"
        >
          <div className="ring-glow relative flex size-56 items-center justify-center rounded-full sm:size-72">
            <div className="orb-ring orb-ring-slow absolute inset-0 rounded-full" />
            <div className="orb-ring-reverse absolute inset-4 rounded-full" />
            <div className="orb-core orb-pulse flex size-36 items-center justify-center rounded-full sm:size-44">
              <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-white/90">
                online
              </span>
            </div>
          </div>
          {/* floating chips */}
          <motion.span
            className="soft-card absolute -left-24 top-6 hidden rounded-xl px-3 py-2 font-mono text-[11px] sm:block"
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          >
            kokoro-82m · q8
          </motion.span>
          <motion.span
            className="soft-card absolute -right-28 top-24 hidden rounded-xl px-3 py-2 font-mono text-[11px] sm:block"
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
          >
            whisper-base · wasm
          </motion.span>
          <motion.span
            className="soft-card absolute -bottom-4 left-10 hidden rounded-xl px-3 py-2 font-mono text-[11px] sm:block"
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 1.1 }}
          >
            fs-tools · trash + undo
          </motion.span>
        </motion.div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
            Capabilities
          </p>
          <h2 className="font-display mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Local intelligence, real tools
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Everything the console does runs inside this tab. No telemetry, no
            uploads, no waiting on someone else's server.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.06 }}
              className="soft-card card-lift rounded-2xl p-6"
            >
              <div className="flex items-start gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                  <f.icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-display text-base font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {f.body}
                  </p>
                  <span className="mt-3 inline-block rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {f.chip}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative z-10 mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
            Boot sequence
          </p>
          <h2 className="font-display mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Three steps to full local control
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className="soft-card card-lift relative rounded-2xl p-6"
            >
              <span className="absolute right-5 top-5 font-mono text-4xl font-semibold text-muted-foreground/15">
                0{i + 1}
              </span>
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                <s.icon className="size-5" />
              </span>
              <h3 className="font-display mt-4 text-base font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="soft-card relative overflow-hidden rounded-3xl px-6 py-12 text-center sm:px-12"
        >
          <div className="aurora" />
          <div className="relative">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <Lock className="size-5" />
            </span>
            <h2 className="font-display mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
              The cloud-free assistant is waiting
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
              Fire up the console, connect a folder, and start talking. Your
              files never leave this device.
            </p>
            <Button asChild size="lg" className="ring-glow mt-7 h-12 rounded-full px-8 text-sm font-medium">
              <a href="/auth">
                Start locally
                <ArrowRight className="ml-1 size-4" />
              </a>
            </Button>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              kokoro tts · whisper stt · ollama brain · 20 tools · plugin bay
            </p>
          </div>
        </motion.div>
      </section>

      <footer className="relative z-10 border-t border-border/70 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p className="flex items-center gap-1.5">
            <Github className="size-3.5" />
            Inspired by open local-AI builds like mark LIII
          </p>
          <p className="font-mono text-[10px] uppercase tracking-widest">
            runs on your device · nothing leaves it
          </p>
        </div>
      </footer>
    </div>
  );
}
