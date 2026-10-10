import http from "node:http";

const page = (dark) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
body{font:16px system-ui;margin:0;background:${dark ? "#111827" : "#f5f7fb"};color:${dark ? "#f9fafb" : "#172033"}}main{max-width:680px;margin:40px auto;padding:28px;background:${dark ? "#1f2937" : "white"};border-radius:20px;box-shadow:0 15px 40px #0002}.entry{display:flex;gap:8px}input{flex:1;padding:12px;border:1px solid #ccd3df;border-radius:10px}button{padding:11px 16px;border:0;border-radius:10px;background:#ff5f35;color:white;cursor:pointer}li{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #ffffff22}li button{background:transparent;color:#ff7655}@media(max-width:600px){main{margin:12px;padding:20px}}</style></head><body><main><h1>今日待办${dark ? " · 深色版" : ""}</h1><p>添加任务，完成后可随时删除。</p><div class="entry"><input id="task" aria-label="新任务" placeholder="输入一项任务"><button id="add" type="button">添加</button></div><ul id="list"></ul></main><script>
const add=document.querySelector('#add'),input=document.querySelector('#task'),list=document.querySelector('#list');add.addEventListener('click',()=>{if(!input.value.trim())return;const li=document.createElement('li');const text=document.createElement('span');text.textContent=input.value;const del=document.createElement('button');del.type='button';del.textContent='删除';del.addEventListener('click',()=>li.remove());li.append(text,del);list.append(li);input.value='';input.focus()});
</script></body></html>`;

http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", () => {
    const dark = body.includes("深色");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: page(dark) } }] }));
  });
}).listen(4010, "127.0.0.1", () => console.log("Mock OpenAI endpoint listening on 4010"));
