// 一次性脚本：生成 VAPID 密钥对，输出可直接写入 KV push:vapid 的 JSON。
//
// 用法（PowerShell 5.1 / 7 通用 BOM-safe 写法）：
//   cd C:\Users\Administrator\Desktop\emet-memory
//   $json = node scripts/generate-vapid.mjs | Out-String
//   [System.IO.File]::WriteAllText("$PWD\vapid.json", $json.TrimEnd(), (New-Object System.Text.UTF8Encoding $false))
//   npx wrangler kv key put --namespace-id=d5a8437042e54a379258239d947b99db --remote "push:vapid" --path=vapid.json
//   Remove-Item vapid.json
//
// 用法（bash/zsh / Linux & macOS）：
//   cd ~/Desktop/emet-memory
//   node scripts/generate-vapid.mjs > vapid.json
//   npx wrangler kv key put --namespace-id=d5a8437042e54a379258239d947b99db --remote "push:vapid" --path=vapid.json
//   rm vapid.json
//
// ⚠ PowerShell 5.1 下千万别用 `node ... > vapid.json`（默认写 UTF-16 LE BOM）
//   或 `Out-File -Encoding utf8`（PS 5.1 该选项写的是 UTF-8 BOM）。
//   两种 BOM 进 KV 后 worker.js 的 JSON.parse 都会抛 SyntaxError → Cloudflare 1101。
//   bash/zsh 下 `>` 重定向是干净 UTF-8（无 BOM），安全。
//
// 输出结构（直接是 KV push:vapid 的 value，worker 端 kvGet("push:vapid") 拿到的就是这个）：
//   {
//     "publicKey":  "<base64url uncompressed P-256 point, 65字节, ≈87字符>",   // 前端 applicationServerKey
//     "privateKey": <JWK object>,                                                 // worker importKey 用
//     "createdAt":  "ISO 8601"
//   }

import { webcrypto } from "node:crypto";

const kp = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,                       // 必须 extractable，下面要 exportKey
  ["sign", "verify"]
);

const publicJwk  = await webcrypto.subtle.exportKey("jwk", kp.publicKey);
const privateJwk = await webcrypto.subtle.exportKey("jwk", kp.privateKey);

// VAPID 公钥 = uncompressed P-256 point：0x04 || X(32) || Y(32)，共 65 字节，base64url
function b64uToBuf(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function bufToB64u(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const x = b64uToBuf(publicJwk.x);
const y = b64uToBuf(publicJwk.y);
if (x.length !== 32 || y.length !== 32) {
  throw new Error(`Unexpected coord length: x=${x.length}, y=${y.length}`);
}
const uncompressed = Buffer.concat([Buffer.from([0x04]), x, y]);
const publicKey    = bufToB64u(uncompressed);

const out = {
  publicKey,
  privateKey: privateJwk,
  createdAt: new Date().toISOString(),
};

console.log(JSON.stringify(out, null, 2));
