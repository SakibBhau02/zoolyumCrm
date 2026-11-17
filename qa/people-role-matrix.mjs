const API = "http://127.0.0.1:4000/api";

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "zoolyum123" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

async function post(token, body) {
  const r = await fetch(`${API}/people/employees`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text };
}

const roles = [
  "sakib@zoolyum.com",
  "nusrat@zoolyum.com",
  "karim@zoolyum.com",
  "sadia@zoolyum.com",
  "rahim@zoolyum.com",
  "sabbir@zoolyum.com",
  "tanvir@zoolyum.com",
];

for (const email of roles) {
  const { accessToken, user } = await login(email);
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const res = await post(accessToken, {
    name: `Role Probe ${stamp}`,
    roleTitle: "Probe",
    joinDate: "2026-11-14",
    salary: 1000,
  });
  console.log(`${email} [${user.role}] PEOPLE=${JSON.stringify(user.permissions?.PEOPLE)} -> ${res.status} ${res.body.slice(0, 160)}`);
  if (res.status < 300) {
    const id = JSON.parse(res.body).id;
    const d = await fetch(`${API}/people/employees/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    console.log(`   cleanup ${d.status}`);
  }
}
