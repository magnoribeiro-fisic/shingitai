// Gera ../app/app.js (um arquivo só, minificado). A apiKey do Firebase web é pública por natureza.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
const cfg = JSON.parse(readFileSync(new URL("./firebase-web.json", import.meta.url)));
await build({ entryPoints: ["main.js"], bundle: true, minify: true, format: "esm", target: "es2020",
  outfile: "../app/app.js", define: {}, banner: { js: "/* Shin Gi Tai — app do aluno */" },
  plugins: [{ name: "chave", setup(b) { b.onLoad({ filter: /main\.js$/ }, (a) => ({ contents: readFileSync(a.path, "utf8").replace("__API_KEY__", cfg.apiKey), loader: "js" })); } }] });
console.log("ok");
