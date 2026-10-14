# Coding agents

The OpenPencil desktop app can use a coding agent you already have — Claude Code, Codex, Gemini CLI, or [Pi](#pi) — as its design agent. The agent runs on your computer with your own subscription and chooses its own model; OpenPencil starts it when you send a message, through the [Agent Client Protocol](https://agentclientprotocol.com/) or, for Pi, its Harness companion, and gives it the canvas tools through OpenPencil's local [MCP server](./mcp-server).

Coding agents need the desktop app; the browser cannot start programs on your computer. The one exception is [Claude Code in the browser](#claude-code-in-the-browser), through a small companion you start yourself. They take only the **Design agent** role. Visual review, plan reviews, and fast background work need an API model, which guided setup can add for you.

## What you need

1. The [OpenPencil desktop app](/download).
2. The agent's ACP program, installed globally (see each agent below).
3. OpenPencil's MCP server, installed globally. Use the version that matches your app:

   ```sh
   npm install -g @open-pencil/mcp
   ```

4. The agent signed in to your account with its own command-line tool.

Then open **Settings → AI & agents → Run guided setup**, choose the agent under **Coding agents on this computer**, and check that both the agent and the MCP server show as installed. **Check again** looks again after you install something.

### Let your agent set itself up

If you already use one of these agents in a terminal, guided setup can do the typing for you: press **Copy setup prompt** on the agent's card and paste the prompt into the agent. It asks the agent to install its ACP program and the MCP server, confirm both are on your `PATH`, and make sure you are signed in.

## Claude Code

```sh
npm install -g @agentclientprotocol/claude-agent-acp
```

Sign in by running `claude` and using `/login`. The ACP program uses the same account as Claude Code.

## Codex

```sh
npm install -g @agentclientprotocol/codex-acp
```

Sign in with `codex login`.

## Gemini CLI

```sh
npm install -g @google/gemini-cli
```

Gemini CLI speaks ACP itself, so there is no separate program. Run `gemini` once and choose a sign-in method.

## Pi

Pi runs through OpenPencil's Harness companion instead of ACP. It needs Node.js 22.15 or later, or Bun. Guided setup installs the companion with one click; to install it yourself, use the version that matches your app:

```sh
npm install -g @open-pencil/harness
```

OpenPencil uses the providers you signed in to in Pi and Pi's default model, so there is no key to paste. Sign in by running `pi` and using `/login`, and pick a default model with `/model`. To use another model in OpenPencil, enter it as `provider/model` in the Pi model's settings. An [AI Gateway](https://vercel.com/ai-gateway) key is optional; when you save one, Pi uses the gateway instead of your Pi sign-ins.

OpenPencil reads only Pi's `settings.json` for the default model; your credentials stay with Pi. Your Pi extensions, themes, and prompt templates are not loaded into OpenPencil's sessions. Pi keeps a conversation's context while it runs; after Pi or OpenPencil restarts, the conversation continues in a fresh Pi session, because Pi's workspace lives in memory.

## Claude Code in the browser {#claude-code-in-the-browser}

The browser app can use Claude Code with your own sign-in through the Harness companion, which runs Claude Code for it and gives it the canvas tools of your open tab.

1. Install Claude Code and sign in by running `claude` and using `/login`.
2. Install and start the companion, naming the address you open OpenPencil at:

   ```sh
   npm install -g @open-pencil/harness
   OPENPENCIL_HARNESS_ORIGINS=https://app.openpencil.dev openpencil-harness-serve
   ```

3. Open the pairing link it prints. OpenPencil saves the pairing like an API key, so whether it survives a reload follows your browser credential setting.
4. In **Settings → AI & agents**, edit the Design model and choose **Claude Code** under **Your agents**. The entry appears once the companion has found the `claude` command.

Running OpenPencil from source with `bun run dev` starts the companion for you, so steps 2 and 3 are not needed there; set `OPENPENCIL_DEV_HARNESS=0` to turn it off.

While Claude Code writes a `render` call, the layers it describes appear on the canvas as their JSX arrives, as they do for API models, and the real layers replace that preview once the call runs. Claude Code runs without its own shell, file, or web tools, and edits the canvas only through the companion's MCP server. Your Claude Code settings, hooks, and `CLAUDE.md` are not loaded, and these sessions are not saved to your Claude Code history. The companion listens only on `127.0.0.1` and accepts connections only from the origins you name and only with the token in the pairing link. It uses port 7610 and starts OpenPencil's MCP server on port 7600, so quit the desktop app first, which uses 7600 too.

## From design to code {#from-design-to-code}

Two tools turn a design into an app and check that the app draws what the design does, so a design agent and a coding agent can hand work back and forth without either guessing:

- **`export_react_project`** writes the design as a React and Tailwind CSS app, the same project as [`openpencil export -f react`](cli/exporting#react-project-export), and returns its files and the `openpencil.json` manifest that maps each screen and component to the layer it draws.
- **`check_code`** lays a screen's code out in a browser inside OpenPencil and compares it with the design: every layer's position, size, fill, text color, font size, and weight at the frame's own width, the colors again in each mode a variable collection switches to, such as Dark, and, at any other widths it is given, whether the page scrolls sideways and which layers reach past the viewport. It lists the largest differences first, with the design's and the code's values.

The loop is: design the screen, run `check_code` with the widths it must work at, fix what it reports in the design, such as a fixed width that should fill its parent, and check again until it passes. Then export the project. The check needs the OpenPencil app, desktop or browser, since it lays code out in a real browser; headless file mode has none.

## Troubleshooting

- **Shown as not found after installing.** Apps started from the Dock or Start menu do not see every folder your terminal adds to `PATH`. OpenPencil also looks in common global folders for npm, Bun, Volta, mise, and Homebrew; if your package manager installs elsewhere, add that folder to your login shell's `PATH` and restart OpenPencil.
- **Shown as update needed.** The MCP server or Pi's companion does not match the app version. Press the update button, or run the command guided setup shows with the package manager that installed it, then press **Check again**. A chat that needs it says so and offers **Run guided setup**.
- **The agent starts but cannot edit the canvas.** The MCP server is missing or not running. Install the matching `@open-pencil/mcp` version and restart OpenPencil.
- **The agent asks you to sign in.** Sign in with the agent's own command-line tool as described above, then send your message again.
