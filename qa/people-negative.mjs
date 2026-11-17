const API = "http://127.0.0.1:4000/api";
const login = async () => {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "sakib@zoolyum.com", password: "zoolyum123" }) });
  return (await r.json()).accessToken;
};
const token = await login();
const h = { "content-type": "application/json", authorization: `Bearer ${token}` };

async function probe(label, body) {
  const r = await fetch(`${API}/people/employees`, { method: "POST", headers: h, body: JSON.stringify(body) });
  const t = await r.text();
  console.log(label, "=>", r.status, t.slice(0, 220));
  if (r.status < 300) {
    const id = JSON.parse(t).id;
    await fetch(`${API}/people/employees/${id}`, { method: "DELETE", headers: h });
  }
}

await probe("dup deviceId", { name: "Dup Dev", roleTitle: "X", joinDate: "2026-11-14", deviceId: "101" });
await probe("empty name", { name: "   ", roleTitle: "X", joinDate: "2026-11-14" });
await probe("bad salary", { name: "Bad Sal", roleTitle: "X", joinDate: "2026-11-14", salary: "abc" });
await probe("bad date", { name: "Bad Date", roleTitle: "X", joinDate: "not-a-date" });
await probe("self manager (new)", { name: "Mgr", roleTitle: "X", joinDate: "2026-11-14", reportingManagerId: "nope" });
await probe("minimal", { name: "Minimal", roleTitle: "X" });
