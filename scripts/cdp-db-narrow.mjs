/** CDP: verify the DB connect bar adapts to narrow tool window width. */
const list = await fetch("http://127.0.0.1:9223/json/list").then((r) => r.json());
const page = list.find((t) => t.type === "page" && t.url.includes("tauri.localhost"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let msgId = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (r.error) return JSON.stringify(r.error);
  if (r.result?.exceptionDetails) {
    return "EXCEPTION: " + (r.result.exceptionDetails.exception?.description ?? "").slice(0, 200);
  }
  return r.result?.result?.value ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Open project if welcome
const inProject = await evaluate(`!!document.querySelector("[role='treeitem']")`);
if (!inProject) {
  const recent = await evaluate(`(() => {
    const els = [...document.querySelectorAll("*")].filter(
      (e) => e.childElementCount === 0 && e.textContent.trim() === "sample_project" && e.getBoundingClientRect().width > 0,
    );
    const el = els[els.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);
  if (recent && typeof recent === "string") {
    const p = JSON.parse(recent);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await sleep(2200);
  }
}

// Open DB tool window
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('nav[data-stripe-side="right"] button')].find(
    (b) => (b.title || "").includes("数据库"),
  );
  if (btn) btn.click();
})()`);
await sleep(600);

// Switch to mysql
await evaluate(`(() => {
  const sel = document.querySelector('[data-tool-window="database"] select');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(sel, "mysql");
  sel.dispatchEvent(new Event("change", { bubbles: true }));
})()`);
await sleep(400);

console.log(
  "LAYOUT:",
  await evaluate(`(() => {
    try {
      const body = document.querySelector('[data-tool-window="database"]');
      if (!body) return "DB WINDOW NOT MOUNTED";
      const bar = body.querySelector('[class*="connectBar"]');
      if (!bar) return "NO CONNECT BAR";
      const inputs = [...body.querySelectorAll("input")];
      const btn = [...body.querySelectorAll("button")].find((b) => b.textContent.trim() === "连接");
      const br = bar.getBoundingClientRect();
      return JSON.stringify({
        barWidth: Math.round(br.width),
        overflowX: bar.scrollWidth > bar.clientWidth + 1,
        scrollVsClient: bar.scrollWidth + "/" + bar.clientWidth,
        inputWidths: inputs.map((i) => Math.round(i.getBoundingClientRect().width)),
        allInputsVisible: inputs.every((i) => i.getBoundingClientRect().width >= 40),
        btnHeight: Math.round(btn.getBoundingClientRect().height),
        btnWrapped: btn.getBoundingClientRect().height > 32,
        barRows: new Set(inputs.map((i) => Math.round(i.getBoundingClientRect().top))).size,
      });
    } catch (e) {
      return "ERR: " + e.message;
    }
  })()`),
);

// Page screenshot for visual confirmation
const shot = await send("Page.captureScreenshot", { format: "png" });
if (shot.result?.data) {
  await import("node:fs").then((fs) => fs.writeFileSync("E:/Project/RustProject/OpenPyCharm/scripts/db-narrow.png", Buffer.from(shot.result.data, "base64")));
  console.log("SCREENSHOT saved: scripts/db-narrow.png");
} else {
  console.log("SCREENSHOT failed:", JSON.stringify(shot.error ?? shot.result ?? null).slice(0, 200));
}

ws.close();
process.exit(0);
