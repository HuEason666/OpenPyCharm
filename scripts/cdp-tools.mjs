/** CDP: verify the agent + database tool windows mount and render. */
const list = await fetch("http://127.0.0.1:9223/json/list").then((r) => r.json());
const page = list.find((t) => t.type === "page");
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
  return r.result?.result?.value ?? null;
}

async function clickStripe(titlePart) {
  return evaluate(`(() => {
    const btn = [...document.querySelectorAll('nav[data-stripe-side="right"] button')].find(
      (b) => (b.title || "").includes(${JSON.stringify(titlePart)}),
    );
    if (!btn) return "NO BUTTON";
    btn.click();
    return "clicked";
  })()`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Open the project if we're on the welcome screen.
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
    await sleep(2000);
  }
}

// Agent tool window
console.log("AGENT CLICK:", await clickStripe("智能体"));
await sleep(600);
console.log("AGENT DOM:", await evaluate(`(() => {
  const body = document.querySelector('[data-tool-window="agent"]');
  if (!body) return "NOT MOUNTED";
  const input = body.querySelector("textarea");
  const header = document.querySelector(".headerTitle");
  return JSON.stringify({
    mounted: true,
    headerText: [...document.querySelectorAll(".headerTitle")].map((h) => h.textContent),
    hasTextarea: !!input,
    placeholder: input?.placeholder?.slice(0, 40) ?? null,
    mentionsConfig: body.textContent.includes("智能体未配置") || body.textContent.includes("向智能体提问"),
  });
})()`));

// Database tool window
console.log("DB CLICK:", await clickStripe("数据库"));
await sleep(600);
console.log("DB DOM:", await evaluate(`(() => {
  const body = document.querySelector('[data-tool-window="database"]');
  if (!body) return "NOT MOUNTED";
  const select = body.querySelector("select");
  const openBtn = [...body.querySelectorAll("button")].find((b) => b.textContent.includes("打开"));
  return JSON.stringify({
    mounted: true,
    dbTypeOptions: select ? [...select.options].map((o) => o.text + (o.disabled ? "(禁用)" : "")) : null,
    hasOpenBtn: !!openBtn,
    openDisabled: openBtn?.disabled ?? null,
    hint: body.textContent.includes("SQLite"),
  });
})()`));

ws.close();
process.exit(0);
